create database IF NOT EXISTS shuttle_demo;
use shuttle_demo;

DROP TABLE IF EXISTS vehicle_location_history;
DROP TABLE IF EXISTS vehicle_runtime;
DROP TABLE IF EXISTS driver_login_session;
DROP TABLE IF EXISTS driver_account;
DROP TABLE IF EXISTS route_info;

CREATE TABLE route_info (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_id VARCHAR(32) NOT NULL UNIQUE,
  route_name VARCHAR(64) NOT NULL,
  service_time VARCHAR(64),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE driver_account (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  open_id VARCHAR(64) NOT NULL,
  driver_name VARCHAR(64) NOT NULL,
  phone VARCHAR(32),
  vehicle_id VARCHAR(32) NOT NULL,
  route_id VARCHAR(32) NOT NULL,
  enabled TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_vehicle(vehicle_id),
  UNIQUE KEY uk_open_id(open_id)
);

CREATE TABLE driver_login_session (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  login_token VARCHAR(64) NOT NULL,
  open_id VARCHAR(64) NOT NULL,
  vehicle_id VARCHAR(32) NOT NULL,
  expire_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_login_token(login_token),
  UNIQUE KEY uk_session_openid(open_id),
  INDEX idx_session_expire(expire_at)
);

CREATE TABLE vehicle_runtime (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  vehicle_id VARCHAR(32) NOT NULL UNIQUE,
  route_id VARCHAR(32) NOT NULL,
  driver_name VARCHAR(64) NOT NULL,
  latitude DECIMAL(10,6),
  longitude DECIMAL(10,6),
  speed DECIMAL(10,2),
  status VARCHAR(16) NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_runtime_route(route_id)
);

CREATE TABLE vehicle_location_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  vehicle_id VARCHAR(32) NOT NULL,
  route_id VARCHAR(32) NOT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  speed DECIMAL(10,2),
  report_time DATETIME NOT NULL,
  INDEX idx_history_vehicle_time(vehicle_id, report_time)
);
