package log

var logger Logger

func RegisterLogger(l Logger) {
	logger = l
}

func SetLevel(level LogLevel) {
	if logger != nil {
		logger.SetLevel(level)
	}
}

func Debugf(msg string, args ...interface{}) {
	if logger != nil {
		logger.Debugf(msg, args...)
	}
}

func Infof(msg string, args ...interface{}) {
	if logger != nil {
		logger.Infof(msg, args...)
	}
}

func Warnf(msg string, args ...interface{}) {
	if logger != nil {
		logger.Warnf(msg, args...)
	}
}

func Errorf(msg string, args ...interface{}) {
	if logger != nil {
		logger.Errorf(msg, args...)
	}
}

func Fatalf(msg string, args ...interface{}) {
	if logger != nil {
		logger.Fatalf(msg, args...)
	}
}
