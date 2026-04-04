# 数据库设计

## route_info

线路主表。

关键字段：
- route_id
- route_name
- service_time

## driver_account

司机账号绑定表。

关键字段：
- open_id
- driver_name
- vehicle_id
- route_id
- enabled

约束：
- `open_id` 唯一
- `vehicle_id` 唯一

## driver_login_session

司机登录态表。

关键字段：
- login_token
- open_id
- vehicle_id
- expire_at

约束：
- `login_token` 唯一
- `open_id` 唯一

## vehicle_runtime

车辆实时状态表。

关键字段：
- vehicle_id
- route_id
- driver_name
- latitude
- longitude
- speed
- status
- updated_at

## vehicle_location_history

历史轨迹表。

关键字段：
- vehicle_id
- route_id
- latitude
- longitude
- speed
- report_time
