package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/finsight-org/finsight/internal/server"
)

func main() {
	if len(os.Args) == 1 {
		fmt.Println("FinSight")
		return
	}
	addr, err := listenAddress(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "Usage: finsight [serve [--addr 127.0.0.1:8080]]")
		os.Exit(2)
	}
	api, err := server.New(os.Getenv("FINSIGHT_API_TOKEN"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "FinSight server configuration is invalid.")
		os.Exit(1)
	}
	srv := &http.Server{Addr: addr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 65 * time.Second, WriteTimeout: 65 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		api.Close()
		if errors.Is(err, syscall.EADDRINUSE) {
			fmt.Fprintf(os.Stderr, "FinSight address %s is already in use.\n", addr)
		} else {
			fmt.Fprintf(os.Stderr, "FinSight could not listen on %s.\n", addr)
		}
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- srv.Serve(listener) }()
	select {
	case <-ctx.Done():
		api.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
		<-done
	case err := <-done:
		api.Close()
		if err != nil && err != http.ErrServerClosed {
			fmt.Fprintln(os.Stderr, "FinSight server failed.")
			os.Exit(1)
		}
	}
}

func listenAddress(args []string) (string, error) {
	if len(args) == 0 || args[0] != "serve" {
		return "", errors.New("serve command required")
	}
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	addr := flags.String("addr", "127.0.0.1:8080", "loopback listen address")
	if err := flags.Parse(args[1:]); err != nil || flags.NArg() != 0 {
		return "", errors.New("invalid serve arguments")
	}
	host, portText, err := net.SplitHostPort(*addr)
	if err != nil {
		return "", errors.New("invalid listen address")
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return "", errors.New("listen address must use a loopback IP")
	}
	if strings.TrimSpace(portText) != portText {
		return "", errors.New("invalid listen port")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return "", errors.New("invalid listen port")
	}
	return net.JoinHostPort(ip.String(), strconv.Itoa(port)), nil
}
