export type ApiRoute =
  | { readonly name: 'health'; readonly method: 'GET' }
  | { readonly name: 'aircraft-list'; readonly method: 'GET' }
  | { readonly name: 'aircraft'; readonly method: 'GET'; readonly id: string }
  | { readonly name: 'aircraft-messages'; readonly method: 'GET'; readonly id: string }
  | { readonly name: 'message'; readonly method: 'GET'; readonly id: string }
  | { readonly name: 'demo-ingest'; readonly method: 'POST' }
  | { readonly name: 'map-aircraft'; readonly method: 'GET'; readonly search: string };
