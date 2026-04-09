package com.example.shuttle.exception;

public class DriverAccountConflictException extends RuntimeException {
    public DriverAccountConflictException(String message) {
        super(message);
    }

    public DriverAccountConflictException(String message, Throwable cause) {
        super(message, cause);
    }
}
