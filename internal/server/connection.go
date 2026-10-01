package server

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/finsight-org/finsight/internal/wealthsimple"
)

type connState uint8

const (
	stateDisconnected connState = iota
	statePendingMFA
	stateConnected
	stateLoggingIn
)

var (
	errAlreadyConnected = errors.New("already connected")
	errPendingExpired   = errors.New("pending MFA expired")
	errEmailMismatch    = errors.New("pending MFA email mismatch")
	errMissingMFA       = errors.New("MFA code required")
	errStale            = errors.New("connection changed")
	errServerClosed     = errors.New("server is shutting down")
)

type connectionManager struct {
	mu            sync.Mutex
	generation    uint64
	state         connState
	client        *wealthsimple.Client
	email         string
	expires       time.Time
	connCtx       context.Context
	connCancel    context.CancelFunc
	attemptCancel context.CancelFunc
	pendingTimer  *time.Timer
	newClient     func() (*wealthsimple.Client, error)
	closed        bool
}

func newConnectionManager(factory func() (*wealthsimple.Client, error)) *connectionManager {
	return &connectionManager{newClient: factory}
}

func (m *connectionManager) Login(ctx context.Context, email, password, code string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return "", wealthsimple.ErrLoginFailed
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return "", errServerClosed
	}
	if m.state == stateConnected {
		m.mu.Unlock()
		return "", errAlreadyConnected
	}
	expiredPending := false
	if m.state == statePendingMFA && time.Now().After(m.expires) {
		expiredPending = true
		m.clearLocked()
	}
	var client *wealthsimple.Client
	if m.state == statePendingMFA && code != "" {
		if email != m.email {
			m.mu.Unlock()
			return "", errEmailMismatch
		}
		m.stopPendingTimerLocked()
		client = m.client
	} else {
		if code != "" {
			m.mu.Unlock()
			if expiredPending {
				return "", errPendingExpired
			}
			return "", errMissingMFA
		}
		if m.attemptCancel != nil {
			m.attemptCancel()
		}
		m.stopPendingTimerLocked()
		var err error
		client, err = m.newClient()
		if err != nil {
			m.mu.Unlock()
			return "", err
		}
		m.client = client
		m.email = email
	}
	if m.attemptCancel != nil {
		m.attemptCancel()
	}
	attemptCtx, cancel := context.WithCancel(ctx)
	m.attemptCancel = cancel
	m.generation++
	generation := m.generation
	m.state = stateLoggingIn
	m.mu.Unlock()
	err := client.Login(attemptCtx, email, password, code)
	m.mu.Lock()
	defer m.mu.Unlock()
	if generation != m.generation {
		return "", errStale
	}
	if err := attemptCtx.Err(); err != nil {
		m.clearLocked()
		return "", err
	}
	cancel()
	m.attemptCancel = nil
	if errors.Is(err, wealthsimple.ErrMFARequired) {
		m.state = statePendingMFA
		m.expires = time.Now().Add(5 * time.Minute)
		m.email = email
		m.pendingTimer = time.AfterFunc(5*time.Minute, func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.state == statePendingMFA && m.generation == generation {
				m.clearLocked()
			}
		})
		return "mfa_required", nil
	}
	if err != nil {
		m.clearLocked()
		return "", err
	}
	m.state = stateConnected
	m.email = ""
	m.expires = time.Time{}
	m.connCtx, m.connCancel = context.WithCancel(context.Background())
	return "connected", nil
}

func (m *connectionManager) clearLocked() {
	m.stopPendingTimerLocked()
	if m.attemptCancel != nil {
		m.attemptCancel()
		m.attemptCancel = nil
	}
	if m.connCancel != nil {
		m.connCancel()
		m.connCancel = nil
	}
	m.generation++
	m.state = stateDisconnected
	m.client = nil
	m.email = ""
	m.expires = time.Time{}
}

func (m *connectionManager) stopPendingTimerLocked() {
	if m.pendingTimer != nil {
		m.pendingTimer.Stop()
		m.pendingTimer = nil
	}
}

func (m *connectionManager) Disconnect() { m.mu.Lock(); defer m.mu.Unlock(); m.clearLocked() }

type lease struct {
	client     *wealthsimple.Client
	ctx        context.Context
	generation uint64
	release    func()
}

func (m *connectionManager) acquire(requestCtx context.Context) (lease, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.state != stateConnected || m.client == nil {
		return lease{}, errNotConnected
	}
	ctx, cancel := context.WithCancel(requestCtx)
	stop := context.AfterFunc(m.connCtx, cancel)
	release := func() { stop(); cancel() }
	context.AfterFunc(ctx, func() { stop() })
	return lease{client: m.client, ctx: ctx, generation: m.generation, release: release}, nil
}

func (m *connectionManager) Shutdown() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	m.clearLocked()
}
func (m *connectionManager) current(generation uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == stateConnected && m.generation == generation
}
func (m *connectionManager) connected() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == stateConnected
}

var errNotConnected = errors.New("provider not connected")

func (m *connectionManager) removeIfCurrent(generation uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == stateConnected && m.generation == generation {
		m.clearLocked()
	}
}
