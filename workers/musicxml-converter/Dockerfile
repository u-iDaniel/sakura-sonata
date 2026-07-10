FROM golang:1.26-bookworm AS builder

WORKDIR /app

# Cache dependencies into image builder's local module cache
COPY go.mod ./
RUN go mod download

COPY . .

# Build binary with optimizations
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o main .

# Actual runtime image
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends musescore ca-certificates && \
    update-ca-certificates 

# Clear apt cache to reduce image size (600 MB+)
RUN rm -rf /var/lib/apt/lists/*

WORKDIR /app 

COPY --from=builder /app/main ./
COPY --from=builder /app/certs ./certs

CMD ["./main"]