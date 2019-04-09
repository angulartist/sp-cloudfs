import * as functions from 'firebase-functions'
import { File } from '@google-cloud/storage'
import { bucket, ordersRef } from './config'
import { randomFileName } from './helpers'
import { STATE } from './models/state'
import {
  overlayImageBuffer,
  resizeImageBuffer,
  saveFileToBucket,
  getGCSSignedURL,
  removeBgApi
} from './utils'

/**
 * [UI] Update the order state to error.
 * @param orderRef Current order firestore document reference
 */
const setOrderError = (
  orderRef: FirebaseFirestore.DocumentReference,
  error: string = ''
) => {
  try {
    if (!orderRef) throw 'setOrderError: No document reference.'

    return orderRef.update({ state: STATE.ERROR, error })
  } catch (error) {
    throw new Error(error)
  }
}

/**
 * Generate a thumbnail and a watermarked and then upload them to GCS
 * @param orderRef Current order firestore document reference
 * @param userId User ID who has instanciate the order
 * @param imageBuffer Image buffer thrown back by the API
 * @param fileName Original file name
 */
export const imageManipulation = async (
  orderRef: FirebaseFirestore.DocumentReference,
  userId: string,
  imageBuffer: Buffer,
  fileName: string
): Promise<FirebaseFirestore.WriteResult> => {
  try {
    if (!orderRef || !imageBuffer || !fileName || !userId)
      throw 'imageManipulation: Argument is missing.'

    // GCS bucket paths
    const [watermarkPath, thumbnailPath]: File[] = [
      bucket.file(`@watermarks/${userId}/${fileName}_${randomFileName()}.png`),
      bucket.file(`@thumbnails/${userId}/${fileName}_${randomFileName()}.png`)
    ]

    if (!watermarkPath || !thumbnailPath)
      throw 'imageManipulation: GCS Path is missing.'

    const sharp$: Promise<Buffer>[] = [
      overlayImageBuffer(imageBuffer),
      resizeImageBuffer(96, 96, imageBuffer)
    ]

    const [watermarkBuffer, thumbnailBuffer]: Buffer[] = await Promise.all(
      sharp$
    )

    if (!watermarkBuffer || !thumbnailBuffer)
      throw 'imageManipulation: Buffer is missing.'

    const gcs$: any[] = [
      saveFileToBucket(watermarkPath, watermarkBuffer),
      saveFileToBucket(thumbnailPath, thumbnailBuffer),
      getGCSSignedURL(watermarkPath),
      getGCSSignedURL(thumbnailPath)
    ]

    const [, , watermarkURL, thumbnailURL] = await Promise.all(gcs$)

    if (!watermarkURL || !thumbnailURL)
      throw 'imageManipulation: Signed URL is missing.'

    return orderRef.update({
      watermarkURL,
      thumbnailURL,
      state: STATE.SUCCESS
    })
  } catch (error) {
    return setOrderError(orderRef, error)
  }
}

/**
 * Main functon.
 */
export const removeBg = functions
  .runWith({ memory: '1GB' })
  .firestore.document('orders/{orderId}')
  .onCreate(
    async (snapShot: FirebaseFirestore.DocumentSnapshot, { params }) => {
      const { orderId }: { [option: string]: any } = params

      const orderRef: FirebaseFirestore.DocumentReference = ordersRef.doc(
        orderId
      )

      const {
        userId,
        originalURL,
        fileName
      }: FirebaseFirestore.DocumentData = snapShot.data()

      if (!orderId || !userId || !originalURL || !fileName || !orderRef)
        throw 'removeBg: Argument is missing.'

      try {
        const imageBuffer: Buffer = await removeBgApi(originalURL)

        if (!imageBuffer) throw 'removeBg: No imageBuffer.'

        return imageManipulation(orderRef, userId, imageBuffer, fileName)
      } catch (error) {
        return setOrderError(orderRef, error)
      }
    }
  )
