import { File } from '@google-cloud/storage'
import { bucket } from './config'

export const randomFileName = () => {
  return Math.random()
    .toString(36)
    .substring(5)
}

export const makeBucketFilePath = (userId, fileName): File =>
  bucket.file(`processed_images/${userId}/${fileName}_${randomFileName()}.png`)
