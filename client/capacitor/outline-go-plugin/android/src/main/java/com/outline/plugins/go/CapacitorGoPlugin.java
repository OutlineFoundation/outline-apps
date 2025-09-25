package com.outline.plugins.go;

import com.getcapacitor.Logger;

public class CapacitorGoPlugin {

    public String echo(String value) {
        Logger.info("Echo", value);
        return value;
    }
}
