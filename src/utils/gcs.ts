import { File } from '@google-cloud/storage'
import { signedUrlCfg } from '../config'

/**
 * Get a signed URL from App Engine
 * @param bucketFilePath File path in GCS project bucket
 */
export const getGCSSignedURL = async (
  bucketFilePath: File
): Promise<string> => {
  if (!bucketFilePath) throw 'getGCSSignedURL: Argument is missing.'

  const [signedURL]: [string] = await bucketFilePath.getSignedUrl(signedUrlCfg)

  if (!signedURL) throw 'getGCSSignedURL: No signed URL thrown back.'

  return signedURL
}

/**
 * Upload a file to GCS for a given path
 * @param bucketFilePath File path in GCS project bucket
 * @param imageBuffer Raw image data
 */
export const saveFileToBucket = async (
  bucketFilePath: File,
  imageBuffer: Buffer
): Promise<void> => {
  if (!bucketFilePath || !imageBuffer)
    throw 'saveFileToBucket: Argument is missing.'

  return bucketFilePath.save(imageBuffer, { contentType: 'image/png' })
}
