package http

import (
	"context"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// WorkspaceProxy keeps the local flight collector behind the same API origin.
func WorkspaceProxy(socket string) http.Handler {
	if socket == "" {
		return nil
	}
	proxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: "workspace"})
	proxy.Transport = &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = "/api/v1" + r.URL.Path
		proxy.ServeHTTP(w, r)
	})
}
