package simple

import (
	golog "log"

	"github.com/eycorsican/go-tun2socks/common/log"
)

type simpleLogger struct {
	level log.LogLevel
}

func NewSimpleLogger() log.Logger {
	return &simpleLogger{log.INFO}
}

func (l *simpleLogger) SetLevel(level log.LogLevel) {
	l.level = level
}

func (l *simpleLogger) Debugf(msg string, args ...interface{}) {
	if l.level <= log.DEBUG {
		l.output(msg, args...)
	}
}

func (l *simpleLogger) Infof(msg string, args ...interface{}) {
	if l.level <= log.INFO {
		l.output(msg, args...)
	}
}

func (l *simpleLogger) Warnf(msg string, args ...interface{}) {
	if l.level <= log.WARN {
		l.output(msg, args...)
	}
}

func (l *simpleLogger) Errorf(msg string, args ...interface{}) {
	if l.level <= log.ERROR {
		l.output(msg, args...)
	}
}

func (l *simpleLogger) Fatalf(msg string, args ...interface{}) {
	golog.Fatalf(msg, args...)
}

func (l *simpleLogger) output(msg string, args ...interface{}) {
	golog.Printf(msg, args...)
}

func init() {
	log.RegisterLogger(NewSimpleLogger())
}
