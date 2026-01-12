FROM denoland/deno:latest

WORKDIR /app

# Copy both packages (public-static depends on host-protocol)
COPY packages/host-protocol ./packages/host-protocol
COPY packages/public-static ./packages/public-static

WORKDIR /app/packages/public-static

# Cache dependencies
RUN deno cache mod.ts

# Default port
ENV PORT=8080
EXPOSE 8080

# Run the server
CMD ["deno", "run", "-A", "mod.ts"]
