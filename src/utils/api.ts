import * as rp from 'request-promise'
import { apiOpts } from '../config'

export const removeBgApi = async (image_url: string): Promise<Buffer> => {
  if (!image_url) throw 'removeBgApi: No image url.'

  return rp({
    ...apiOpts,
    formData: { ...apiOpts.formData, image_url }
  })
}
