# WANEES shared contracts

`src/index.ts` contains the versioned API metadata types, public feature flag
names, live revision shape, and proposal metadata shared by the visitor web
app, native-app follow-up, and operator tooling.

Keep this package dependency-free. Import it from server routes and generated
client adapters rather than duplicating contract strings in each application.
