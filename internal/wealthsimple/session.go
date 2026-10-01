package wealthsimple

// session is private so callers cannot accidentally serialize its credentials
// as an API response. The client mutex protects all access to this value.
type session struct {
	accessToken  string
	refreshToken string
	clientID     string
	deviceID     string
	sessionID    string
	generation   uint64
}

// String and GoString also protect diagnostic formatting of a Client.
func (session) String() string   { return "[redacted session]" }
func (session) GoString() string { return "[redacted session]" }

func (c *Client) snapshot() (session, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.session.accessToken == "" {
		return session{}, ErrNotConnected
	}
	return c.session, nil
}
