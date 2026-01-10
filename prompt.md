the apps host application is a deno server using b3nd and firecat backend that works as a multitenant app host
optimized for frontend first and frontend only applications that are also using b3nd and firecat for their app
the idea is to allow a flow that works like this

- user develops application manually or with agent
- user builds their application frontend
- user writes build as version content to b3nd
- user writes target version content to current version to b3nd
- user updates their cname records to point to app to load current version

the user must first register the app when we check their dns to identify what's
the authenticated path, could be something like canonical cname for domain or a record
however possible and flexible, and then another text record pointing to latest version
b3nd url? Or better the cname use a subdomain that identifies the latest version
url totally or partially, but the idea is how to securely enable the domain
and the versions and the target current version to be mapped in a way that can't
be gamed without authentication and proper measures

i.e.

map domain target = ...
build content = immutable://accounts/:userkey/versions/:version => build content gzipped
current target version = mutable://accounts/:userkey/target => version url

this should enable a very easy workflow that is fast and updates  really quyick
for developers and creators pushing new content online, and it should work with
the btc command line, taking into consideration that instead of containerized
deployments and images, we would instead then be using write to b3nd and
serve from tagged target version

m0@ha appsfirecat % btc

BTC CLI v0.1.0

Usage:
  btc <command> [options]

Configuration Commands:
  provider [<value>]        Set/show container registry provider (default: ghcr.io/bandeira-tech)
  project [<value>]         Set/show project name (default: dirname)
  tag [<value>]             Set/show tag (default: latest)
  env [<value>]             Set/show env file path (default: "")
  target [<value>]          Set/show Docker target (default: $provider/$project:$tag)

Build & Deploy Commands:
  build                     Build Docker image with configured target
                            If no Dockerfile exists, auto-generates one by:
                            - Running npm build script
                            - Creating a Dockerfile to serve dist/ statically
  preview                   Run the latest Docker image
  release                   Push Docker image to registry
  ship <environment>        Set tag and env, then build and push
                            Examples: production, staging

Other:
  help                      Show this help message
  version                   Show version information

Examples:
  btc provider ghcr.io/myorg
  btc project my-app
  btc tag dev
  btc env .env.production
  btc build
  btc preview
  btc release
  btc ship production         # Sets tag=production, env=./.env.production, builds and pushes
  btc ship staging            # Sets tag=staging, env=./.env.staging, builds and pushes

the final server app should allow me and anyone else to run these decentralized
hosts servers that always work the same to serve content from b3nd
