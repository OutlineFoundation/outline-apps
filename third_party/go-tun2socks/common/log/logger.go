package log

type LogLevel uint8

const (
	DEBUG LogLevel = iota
	INFO
	WARN
	ERROR
	NONE
)

type Logger interface {
	SetLevel(level LogLevel)
	Debugf(msg string, args ...interface{})
	Infof(msg string, args ...interface{})
	Warnf(msg string, args ...interface{})
	Errorf(msg string, args ...interface{})
	Fatalf(msg string, args ...interface{})
}
