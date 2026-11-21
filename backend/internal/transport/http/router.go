// Package http composition helpers live at the transport root and are owned by BE-24.
package http

import stdhttp "net/http"

type Endpoints struct{ WatchRules, Sources, Aircraft, Messages, Decoders, Alerts, Events, Workspace stdhttp.Handler }

func Router(health stdhttp.Handler, endpoints Endpoints) stdhttp.Handler {
	mux := stdhttp.NewServeMux()
	if health != nil {
		mux.Handle("/api/health", health)
	}
	api := stdhttp.NewServeMux()
	mountCollection(api, "/watch-rules", endpoints.WatchRules)
	mountCollection(api, "/sources", endpoints.Sources)
	mount(api, "/map/", endpoints.Aircraft)
	mount(api, "/workspace/", endpoints.Workspace)
	mountCollection(api, "/aircraft", endpoints.Aircraft)
	mountCollection(api, "/flights", endpoints.Aircraft)
	mountCollection(api, "/messages", endpoints.Messages)
	mountCollection(api, "/decoders", endpoints.Decoders)
	mountCollection(api, "/alert-rules", endpoints.Alerts)
	mountCollection(api, "/alert-events", endpoints.Alerts)
	mountCollection(api, "/events", endpoints.Events)
	mux.Handle("/api/v1/", stdhttp.StripPrefix("/api/v1", api))
	return mux
}
func mountCollection(mux *stdhttp.ServeMux, path string, h stdhttp.Handler) {
	mount(mux, path, h)
	mount(mux, path+"/", h)
}
func mount(mux *stdhttp.ServeMux, path string, h stdhttp.Handler) {
	if h != nil {
		mux.Handle(path, h)
	}
}
