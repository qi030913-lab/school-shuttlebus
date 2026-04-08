module.exports = {
  parseCoordinate(value) {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  },

  isValidLatitude(value) {
    return typeof value === 'number' && value >= -90 && value <= 90
  },

  isValidLongitude(value) {
    return typeof value === 'number' && value >= -180 && value <= 180
  },

  normalizeCoordinatePair(latitudeValue, longitudeValue, debugSource = '') {
    const latitude = this.parseCoordinate(latitudeValue)
    const longitude = this.parseCoordinate(longitudeValue)

    if (latitude === null || longitude === null) {
      if (debugSource && typeof this.logLocationDebug === 'function') {
        this.logLocationDebug(`${debugSource}-coordinate-missing`, {
          latitudeValue,
          longitudeValue,
          latitude,
          longitude
        })
      }
      return {
        latitude: null,
        longitude: null
      }
    }

    if (this.isValidLatitude(latitude) && this.isValidLongitude(longitude)) {
      return { latitude, longitude }
    }

    if (this.isValidLatitude(longitude) && this.isValidLongitude(latitude)) {
      if (debugSource && typeof this.logLocationDebug === 'function') {
        this.logLocationDebug(`${debugSource}-coordinate-swapped`, {
          latitudeValue,
          longitudeValue,
          normalizedLatitude: longitude,
          normalizedLongitude: latitude
        })
      }
      return {
        latitude: longitude,
        longitude: latitude
      }
    }

    if (debugSource && typeof this.logLocationDebug === 'function') {
      this.logLocationDebug(`${debugSource}-coordinate-invalid`, {
        latitudeValue,
        longitudeValue,
        latitude,
        longitude
      })
    }

    return {
      latitude: null,
      longitude: null
    }
  },

  formatDistance(distanceMeters) {
    if (distanceMeters < 1000) {
      return `${Math.round(distanceMeters)}m`
    }
    if (distanceMeters < 10000) {
      return `${(distanceMeters / 1000).toFixed(1)}km`
    }
    return `${Math.round(distanceMeters / 1000)}km`
  },

  parseTimeToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!match) {
      return null
    }

    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null
    }

    return hours * 60 + minutes
  },

  formatCoordinateText(value) {
    return value !== null ? value.toFixed(6) : '--'
  },

  formatClock(date) {
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  },

  formatUpdateTime(value) {
    if (!value) {
      return '--'
    }

    if (Array.isArray(value) && value.length >= 6) {
      const [year, month, day, hour, minute, second] = value
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
    }

    if (typeof value === 'string') {
      return value.replace('T', ' ').slice(0, 19)
    }

    if (typeof value === 'number') {
      return this.formatDateTime(new Date(value))
    }

    if (typeof value === 'object') {
      const year = value.year
      const month = value.monthValue || value.month
      const day = value.dayOfMonth || value.day
      const hour = value.hour
      const minute = value.minute
      const second = value.second

      if (
        year !== undefined
        && month !== undefined
        && day !== undefined
        && hour !== undefined
        && minute !== undefined
        && second !== undefined
      ) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
      }
    }

    return '--'
  },

  formatDateTime(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hh}:${mm}:${ss}`
  }
}
