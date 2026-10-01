package main

import "testing"

func TestListenAddressRestrictsBindingToLoopback(t *testing.T) {
	for _, test := range []struct {
		args  []string
		want  string
		valid bool
	}{
		{[]string{"serve"}, "127.0.0.1:8080", true},
		{[]string{"serve", "--addr", "127.0.0.1:8081"}, "127.0.0.1:8081", true},
		{[]string{"serve", "--addr", "[::1]:8081"}, "[::1]:8081", true},
		{[]string{"serve", "--addr", "0.0.0.0:8080"}, "", false},
		{[]string{"serve", "--addr", "example.com:8080"}, "", false},
		{[]string{"serve", "--addr", "127.0.0.1:0"}, "", false},
		{[]string{"serve", "--addr", "127.0.0.1:65536"}, "", false},
		{[]string{"serve", "unexpected"}, "", false},
	} {
		got, err := listenAddress(test.args)
		if test.valid && (err != nil || got != test.want) {
			t.Errorf("listenAddress(%v)=(%q,%v), want %q", test.args, got, err, test.want)
		}
		if !test.valid && err == nil {
			t.Errorf("listenAddress(%v) accepted %q", test.args, got)
		}
	}
}
