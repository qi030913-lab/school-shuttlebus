# 数据库设计

## route_info

线路主表。

关键字段：
- route_id
- route_name
- service_time

## station_info

站点表。

关键字段：
- station_id
- route_id
- station_name
- sequence_no
- latitude
- longitude

## driver_account

司机账号绑定表。

关键字段：
- open_id：微信小程序用户唯一标识
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
- login_token：后端生成的业务登录态
- open_id
- vehicle_id
- expire_at

约束：
- `login_token` 唯一
- `open_id` 唯一

用途：
- 司机登录后，后端返回 `loginToken`
- 小程序后续请求通过 `X-Driver-Token` 携带
- 后端校验 token 是否存在且未过期

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
- nearest_station_name
- distance_to_station_meters
- eta_minutes
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
