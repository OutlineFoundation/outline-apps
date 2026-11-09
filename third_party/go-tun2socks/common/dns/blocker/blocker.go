// +build !windows

package blocker

import (
	"errors"
)

func BlockOutsideDns(tunName string) error {
	return errors.New("not implemented")
}
