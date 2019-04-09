import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import * as storage from '@google-cloud/storage'
admin.initializeApp()

// Firestore
export const db = admin.firestore()
db.settings({ timestampsInSnapshots: true })
export const timestamp: FirebaseFirestore.FieldValue = admin.firestore.FieldValue.serverTimestamp()
export const ordersRef: FirebaseFirestore.CollectionReference = db.collection(
  'orders'
)

// Storage
export const gcs = new storage.Storage()
export const bucketName = functions.config().bucket.name
export const bucket = gcs.bucket(bucketName)
export const signedUrlCfg: {
  action: 'read' | 'write' | 'delete' | 'resumable'
  expires: string
} = { action: 'read', expires: '01-01-6969' }

// RemoveBG
export const overlayURL: string =
  'https://i.kym-cdn.com/photos/images/masonry/001/452/786/271.png'
const size: string = 'auto'
const encoding: any = null
export const key = functions.config().removebg.key
export const apiOpts = {
  method: 'POST',
  uri: 'https://api.remove.bg/v1.0/removebg',
  formData: { size },
  headers: { 'X-Api-Key': key },
  encoding
}
