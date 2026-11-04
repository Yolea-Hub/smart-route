/** Position of the Sky's sun disc, 0 to 1 across the day (06:00 sunrise, 18:00 sunset); null at night: the disc is absent. */
export function sunPosition(date: Date): number | null {
  const hours = date.getHours() + date.getMinutes() / 60
  if (hours < 6 || hours > 18) return null
  return (hours - 6) / 12
}
