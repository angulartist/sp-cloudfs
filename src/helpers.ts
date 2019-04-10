export const randomFileName = () => {
  return Math.random()
    .toString(36)
    .substring(5)
}
