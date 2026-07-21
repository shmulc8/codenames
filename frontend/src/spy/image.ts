const MAX_LONG_EDGE = 1280
const JPEG_QUALITY = 0.8

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('לא ניתן לקרוא את התמונה שנבחרה'))
    image.src = source
  })
}

export async function prepareSpyImage(file: File): Promise<string> {
  const source = URL.createObjectURL(file)

  try {
    const image = await loadImage(source)
    const longEdge = Math.max(image.naturalWidth, image.naturalHeight)
    const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))

    const context = canvas.getContext('2d')
    if (!context) throw new Error('לא ניתן לעבד את התמונה')

    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } finally {
    URL.revokeObjectURL(source)
  }
}
