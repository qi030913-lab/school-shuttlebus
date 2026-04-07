const BASE_URL = 'https://gps.hiwcq.com'
const WS_URL = 'wss://gps.hiwcq.com/ws/vehicles'
const MAX_SPEED_SAMPLE_AGE_MS = 30000
const MIN_SPEED_SAMPLE_DELTA_MS = 800
const MAX_REASONABLE_VEHICLE_SPEED_MPS = 55

function request(url, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json'
      },
      success: res => {
        const body = res.data || {}
        if (body.success === false) {
          reject(body)
          return
        }
        resolve(body.data !== undefined ? body.data : body)
      },
      fail: err => reject(err)
    })
  })
}

function normalizeNonNegativeNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : null
}

function hasValidCoordinatePair(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
}

function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRadians = degree => (degree * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function parseUpdateTimeToTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (Array.isArray(value) && value.length >= 6) {
    const parts = value.map(Number)
    const [year, month, day, hour, minute, second] = parts
    const fraction = Number.isFinite(parts[6]) ? parts[6] : 0
    const millisecond = fraction > 999 ? Math.floor(fraction / 1000000) : fraction
    if (
      Number.isFinite(year)
      && Number.isFinite(month)
      && Number.isFinite(day)
      && Number.isFinite(hour)
      && Number.isFinite(minute)
      && Number.isFinite(second)
    ) {
      return new Date(year, month - 1, day, hour, minute, second, Number.isFinite(millisecond) ? millisecond : 0).getTime()
    }
    return null
  }

  if (typeof value === 'string') {
    const text = value.trim()
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
    if (match) {
      const [, year, month, day, hour, minute, second] = match
      return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ).getTime()
    }

    const parsed = Date.parse(text)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (typeof value === 'object') {
    const year = Number(value.year)
    const month = Number(value.monthValue || value.month)
    const day = Number(value.dayOfMonth || value.day)
    const hour = Number(value.hour)
    const minute = Number(value.minute)
    const second = Number(value.second)
    const millisecond = Number.isFinite(Number(value.nano))
      ? Math.floor(Number(value.nano) / 1000000)
      : 0

    if (
      Number.isFinite(year)
      && Number.isFinite(month)
      && Number.isFinite(day)
      && Number.isFinite(hour)
      && Number.isFinite(minute)
      && Number.isFinite(second)
    ) {
      return new Date(year, month - 1, day, hour, minute, second, millisecond).getTime()
    }
  }

  return null
}

function resolveVehicleCurrentSpeed(current, previousSample, receivedAt = Date.now()) {
  const reportedSpeed = normalizeNonNegativeNumber(current && current.speed)
  const currentLatitude = Number(current && current.latitude)
  const currentLongitude = Number(current && current.longitude)
  const currentTimestamp = parseUpdateTimeToTimestamp(current && current.updateTime) || receivedAt
  const currentHasLocation = hasValidCoordinatePair(currentLatitude, currentLongitude)
  const currentStatus = String((current && current.status) || '').toUpperCase()

  if (currentStatus === 'STOPPED') {
    return 0
  }

  if (previousSample) {
    const previousSpeed = normalizeNonNegativeNumber(previousSample.speed)
    const previousTimestamp = Number.isFinite(previousSample.timestamp) ? previousSample.timestamp : null
    const previousLatitude = Number(previousSample.latitude)
    const previousLongitude = Number(previousSample.longitude)
    const previousHasLocation = hasValidCoordinatePair(previousLatitude, previousLongitude)
    const sameCoordinate = currentHasLocation
      && previousHasLocation
      && currentLatitude === previousLatitude
      && currentLongitude === previousLongitude

    if (sameCoordinate) {
      if (
        currentTimestamp !== null
        && previousTimestamp !== null
        && currentTimestamp === previousTimestamp
        && previousSpeed !== null
        && previousSpeed <= MAX_REASONABLE_VEHICLE_SPEED_MPS
      ) {
        return previousSpeed
      }
      return 0
    }

    if (currentHasLocation && previousHasLocation && currentTimestamp !== null && previousTimestamp !== null) {
      const deltaMs = currentTimestamp - previousTimestamp
      if (deltaMs >= MIN_SPEED_SAMPLE_DELTA_MS && deltaMs <= MAX_SPEED_SAMPLE_AGE_MS) {
        const distance = calculateDistanceMeters(
          previousLatitude,
          previousLongitude,
          currentLatitude,
          currentLongitude
        )
        const derivedSpeed = distance / (deltaMs / 1000)
        if (
          Number.isFinite(derivedSpeed)
          && derivedSpeed >= 0
          && derivedSpeed <= MAX_REASONABLE_VEHICLE_SPEED_MPS
        ) {
          return derivedSpeed
        }
      }

      if (deltaMs <= 0 && previousSpeed !== null && previousSpeed <= MAX_REASONABLE_VEHICLE_SPEED_MPS) {
        return previousSpeed
      }
    }
  }

  if (reportedSpeed !== null && reportedSpeed <= MAX_REASONABLE_VEHICLE_SPEED_MPS) {
    return reportedSpeed
  }

  return 0
}

function buildVehicleMotionSnapshot(item, latitude, longitude, speed, receivedAt = Date.now(), heading = 0) {
  const hasLocation = hasValidCoordinatePair(latitude, longitude)
  const parsedTimestamp = parseUpdateTimeToTimestamp(item && item.updateTime)

  return {
    latitude: hasLocation ? latitude : null,
    longitude: hasLocation ? longitude : null,
    speed: normalizeNonNegativeNumber(speed),
    timestamp: parsedTimestamp !== null ? parsedTimestamp : receivedAt,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : 0
  }
}

module.exports = {
  BASE_URL,
  WS_URL,
  request,
  calculateDistanceMeters,
  parseUpdateTimeToTimestamp,
  resolveVehicleCurrentSpeed,
  buildVehicleMotionSnapshot
}
