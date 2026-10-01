// wsdev is an interactive development client. Each invocation owns a fresh
// in-memory Wealthsimple session, which is discarded when the process exits.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"text/tabwriter"
	"unicode"

	"github.com/finsight-org/finsight/internal/wealthsimple"
	"golang.org/x/term"
)

type provider interface {
	Login(context.Context, string, string, string) error
	Accounts(context.Context) (wealthsimple.AccountsResult, error)
}

type command struct {
	input      io.Reader
	output     io.Writer
	diagnostic io.Writer
	secret     func() (string, error)
	newClient  func() (provider, error)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	code := run(ctx, os.Args[1:], command{
		input: os.Stdin, output: os.Stdout, diagnostic: os.Stderr,
		secret: func() (string, error) {
			if !term.IsTerminal(int(os.Stdin.Fd())) {
				return "", errors.New("run wsdev in an interactive terminal to enter credentials")
			}
			value, err := term.ReadPassword(int(os.Stdin.Fd()))
			secret := string(value)
			clear(value)
			return secret, err
		},
		newClient: func() (provider, error) { return wealthsimple.NewClient(wealthsimple.Options{}) },
	})
	stop()
	os.Exit(code)
}

func run(ctx context.Context, args []string, cmd command) int {
	usage := func() {
		fmt.Fprintln(cmd.diagnostic, "Usage: wsdev accounts [--json]\nEach invocation prompts for Wealthsimple login and MFA as needed.")
	}
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		usage()
		return 0
	}
	if len(args) == 0 || args[0] != "accounts" {
		usage()
		return 2
	}
	flags := flag.NewFlagSet("accounts", flag.ContinueOnError)
	flags.SetOutput(cmd.diagnostic)
	flags.Usage = usage
	asJSON := flags.Bool("json", false, "write account results as JSON")
	if err := flags.Parse(args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 0 {
		usage()
		return 2
	}
	client, err := cmd.newClient()
	if err != nil {
		fmt.Fprintln(cmd.diagnostic, "Could not initialize the Wealthsimple client.")
		return 1
	}
	fmt.Fprint(cmd.diagnostic, "Wealthsimple email: ")
	email, err := bufio.NewReader(cmd.input).ReadString('\n')
	if err != nil || strings.TrimSpace(email) == "" {
		fmt.Fprintln(cmd.diagnostic, "Could not read your email address.")
		return 1
	}
	fmt.Fprint(cmd.diagnostic, "Password: ")
	password, err := cmd.secret()
	fmt.Fprintln(cmd.diagnostic)
	if err != nil {
		fmt.Fprintln(cmd.diagnostic, "Could not read the password. Use an interactive terminal.")
		return 1
	}
	err = client.Login(ctx, strings.TrimSpace(email), password, "")
	if errors.Is(err, wealthsimple.ErrMFARequired) {
		fmt.Fprint(cmd.diagnostic, "MFA code: ")
		code, readErr := cmd.secret()
		fmt.Fprintln(cmd.diagnostic)
		if readErr != nil || strings.TrimSpace(code) == "" {
			password = ""
			fmt.Fprintln(cmd.diagnostic, "Could not read the MFA code.")
			return 1
		}
		err = client.Login(ctx, strings.TrimSpace(email), password, strings.TrimSpace(code))
		code = ""
	}
	password = ""
	if err != nil {
		fmt.Fprintln(cmd.diagnostic, safeError(err))
		return 1
	}
	result, fetchErr := client.Accounts(ctx)
	if fetchErr != nil && len(result.Accounts) == 0 && len(result.Warnings) == 0 {
		fmt.Fprintln(cmd.diagnostic, safeError(fetchErr))
		return 1
	}
	if err := writeAccounts(cmd.output, result, *asJSON); err != nil {
		fmt.Fprintln(cmd.diagnostic, "Could not write account results.")
		return 1
	}
	for _, warning := range result.Warnings {
		fmt.Fprintln(cmd.diagnostic, "Warning:", terminalText(warning.AccountID), terminalText(warning.Message))
	}
	if fetchErr != nil {
		fmt.Fprintln(cmd.diagnostic, safeError(fetchErr))
		return 1
	}
	return 0
}

func writeAccounts(out io.Writer, result wealthsimple.AccountsResult, asJSON bool) error {
	if asJSON {
		encoder := json.NewEncoder(out)
		encoder.SetIndent("", "  ")
		return encoder.Encode(result)
	}
	if len(result.Accounts) == 0 {
		message := "No open Wealthsimple accounts."
		if len(result.Warnings) > 0 {
			message = "No account data could be returned."
		}
		_, err := fmt.Fprintln(out, message)
		return err
	}
	w := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
	fmt.Fprintln(w, "ACCOUNT\tTYPE\tID\tBALANCE TYPE\tBALANCE\tCURRENCY")
	for _, account := range result.Accounts {
		amount, currency, kind := "unavailable", "—", "account value"
		if account.Balance != nil {
			amount, currency = string(account.Balance.Amount), account.Balance.Currency
		}
		if account.BalanceKind == "amount_owed" {
			kind = "amount owed"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n", terminalText(account.Name), terminalText(account.Type), terminalText(account.ID), kind, amount, terminalText(currency))
	}
	return w.Flush()
}

func terminalText(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			return ' '
		}
		return r
	}, s)
}

// Print only known provider errors. Future adapters must not accidentally print
// upstream response bodies, HTTP headers, or credential-bearing error strings.
func safeError(err error) string {
	for _, known := range []error{
		wealthsimple.ErrMFARequired, wealthsimple.ErrLoginFailed, wealthsimple.ErrNotConnected,
		wealthsimple.ErrReconnectRequired, wealthsimple.ErrRateLimited, wealthsimple.ErrNetwork,
		wealthsimple.ErrInvalidResponse, wealthsimple.ErrUpstream, wealthsimple.ErrPartialResponse,
		wealthsimple.ErrPagination, context.Canceled, context.DeadlineExceeded,
	} {
		if errors.Is(err, known) {
			return known.Error()
		}
	}
	return "The Wealthsimple request failed."
}
