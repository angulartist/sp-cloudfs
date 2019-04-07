import * as functions from 'firebase-functions'
import * as rp from 'request-promise'
import * as fs from 'fs-extra'
import * as sharp from 'sharp'
import { tmpdir } from 'os'
import { join } from 'path'
import { db, bucket, signedUrlCfg, apiOpts } from './config'
import { randomFileName, makeBucketFilePath } from './helpers'
// Models
import { STATE } from './models/state'

const ordersRef: FirebaseFirestore.CollectionReference = db.collection('orders')

const setOrderError = (orderRef: FirebaseFirestore.DocumentReference) => {
  try {
    return orderRef.update({ state: STATE.ERROR })
  } catch (error) {
    throw new Error(error)
  }
}

const makeThumb = async (
  orderRef: FirebaseFirestore.DocumentReference,
  imageBuffer: Buffer,
  fileName: string
) => {
  const workingDir = join(tmpdir(), 'thumbs')
  const thumbFileName = `@thumb_${fileName}`
  const tmpFilePath = join(workingDir, `@removedbg_${fileName}`)
  const bucketFilePath = bucket.file(
    `@thumbs/${thumbFileName}_${randomFileName()}.png`
  )

  try {
    await fs.ensureDir(workingDir)

    await new Promise((resolve, reject) => {
      fs.writeFile(tmpFilePath, imageBuffer, err => {
        if (err) reject(err)
        else resolve()
      })
    })

    const thumbBuffer = await sharp(tmpFilePath)
      .resize(96, 96)
      .png()
      .toBuffer()

    fs.remove(workingDir)

    await bucketFilePath.save(thumbBuffer, { contentType: 'image/png' })

    const signedURL = await bucketFilePath.getSignedUrl(signedUrlCfg)

    return orderRef.update({
      previewURL: signedURL
    })
  } catch (error) {
    return setOrderError(orderRef)
  }
}

export const removeBg = functions.firestore
  .document('orders/{orderId}')
  .onCreate(
    async (snapShot: FirebaseFirestore.DocumentSnapshot, { params }) => {
      const { orderId } = params
      const { userId, originalURL, fileName } = snapShot.data()
      const orderRef = ordersRef.doc(orderId)

      try {
        const imageBuffer: Buffer = await rp({
          ...apiOpts,
          formData: { ...apiOpts.formData, image_url: originalURL }
        })

        if (!imageBuffer) return setOrderError(orderRef)

        makeThumb(orderRef, imageBuffer, fileName)

        const bucketFilePath = makeBucketFilePath(userId, fileName)

        await bucketFilePath.save(imageBuffer, {
          contentType: 'image/png'
        })

        const signedURL = await bucketFilePath.getSignedUrl(signedUrlCfg)

        return orderRef.update({
          downloadURL: signedURL,
          state: STATE.SUCCESS
        })
      } catch (error) {
        return setOrderError(orderRef)
      }
    }
  )
