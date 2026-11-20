package positions

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const maxTokenResponseBytes = 64 << 10

// ClientCredentialsTokenProvider implements OpenSky's OAuth2 client-credentials flow.
// Credentials and bearer tokens are held only in memory and are never included in errors.
type ClientCredentialsTokenProvider struct {
	client       *http.Client
	tokenURL     string
	clientID     string
	clientSecret string
	mu           sync.Mutex
	token        string
	expiresAt    time.Time
	now          func() time.Time
}

func (p *ClientCredentialsTokenProvider) AccessToken(ctx context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now
	if p.now != nil {
		now = p.now
	}
	if p.token != "" && now().Add(30*time.Second).Before(p.expiresAt) {
		return p.token, nil
	}
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", sourceError(ErrorNotConfigured, err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := p.client.Do(request)
	if err != nil {
		return "", sourceError(ErrorTransport, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", &SourceError{Kind: ErrorNotConfigured, StatusCode: response.StatusCode}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxTokenResponseBytes+1))
	if err != nil {
		return "", sourceError(ErrorTransport, err)
	}
	if len(body) > maxTokenResponseBytes {
		return "", sourceError(ErrorResultLimit, nil)
	}
	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tokenResponse); err != nil || tokenResponse.AccessToken == "" || tokenResponse.ExpiresIn <= 30 {
		return "", sourceError(ErrorInvalidResponse, err)
	}
	p.token = tokenResponse.AccessToken
	p.expiresAt = now().Add(time.Duration(tokenResponse.ExpiresIn) * time.Second)
	return p.token, nil
}

func (p *ClientCredentialsTokenProvider) Invalidate() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.token = ""
	p.expiresAt = time.Time{}
}
