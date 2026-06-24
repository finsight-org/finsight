FROM golang:1.26-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /bin/finsight-api ./cmd/finsight-api

FROM alpine:3.22

RUN addgroup -S finsight && adduser -S -G finsight finsight

USER finsight
WORKDIR /app

COPY --from=builder /bin/finsight-api /app/finsight-api

EXPOSE 8080

ENTRYPOINT ["/app/finsight-api"]
