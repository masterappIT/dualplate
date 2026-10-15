import { createWorker } from 'tesseract.js'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const tessdataPath = resolve(dirname(fileURLToPath(import.meta.url)), '../tessdata')

export const cardFields = ['cardNumber','company','contractor','crossing','serial','mainlandPlate','localPlate','driver1','driver2','driver3','currentApproval','previousApproval','color','seats','purpose','validFrom','validTo','notes']
const rectangles = {
  front: {cardNumber:{left:205,top:148,width:270,height:60},company:{left:206,top:213,width:610,height:62},contractor:{left:204,top:368,width:630,height:80},crossing:{left:202,top:488,width:170,height:65},serial:{left:795,top:554,width:175,height:60}},
  back: {mainlandPlate:{left:210,top:37,width:275,height:66},localPlate:{left:210,top:101,width:275,height:64},driver1:{left:244,top:153,width:300,height:59},driver2:{left:244,top:210,width:300,height:59},currentApproval:{left:677,top:39,width:336,height:64},previousApproval:{left:677,top:101,width:336,height:63},color:{left:685,top:157,width:210,height:58},seats:{left:687,top:216,width:210,height:58},purpose:{left:201,top:312,width:220,height:72},validity:{left:195,top:412,width:540,height:75},notes:{left:197,top:481,width:760,height:110}}
}
export function cardData(value) { try { const o=JSON.parse(value||'{}'); return Object.fromEntries(cardFields.map(k=>[k,String(o?.[k]??'')])) } catch { return Object.fromEntries(cardFields.map(k=>[k,''])) } }
export function cleanCard(input) { return Object.fromEntries(cardFields.map(k=>[k,String(input?.[k]??'').trim().slice(0,k==='notes'?500:150)])) }
const tidy = value => String(value||'').replace(/[\n\r]/g,' ').replace(/\s+/g,' ').replace(/^[:：，,]\s*/,'').trim()
const normalize = (key,value) => {
  let s=tidy(value)
  if (['cardNumber','serial'].includes(key)) return (s.match(/\d{5,}/)||[])[0]||''
  if (key==='company'||key==='contractor') return s.replace(/\s+(?=[\u4e00-\u9fff])/g,'').replace(/(?<=[\u4e00-\u9fff])\s+/g,'')
  if (key==='mainlandPlate') return s.replace(/\s+/g,'').replace(/^粤/,'粵').replace(/洪$/,'港')
  if (key==='localPlate') return s.replace(/\s+/g,'')
  if (key==='driver1'||key==='driver2') return s.replace(/\s+/g,'')
  if (key==='currentApproval'||key==='previousApproval') return s.replace(/\s+/g,'')
  if (key==='color'||key==='seats'||key==='crossing'||key==='purpose') return s.replace(/[;；]$/,'').replace(/\s+/g,'')
  return s
}
export async function recognizeCard(image, side) {
  const result={}
  const {data:normalized}=await sharp(image).resize({width:1015,height:645,fit:'fill'}).png().toBuffer({resolveWithObject:true})
  const worker=await createWorker('chi_sim',1,{langPath:tessdataPath,gzip:false,cachePath:tessdataPath,cacheMethod:'readOnly'})
  try {
    for(const [field,rectangle] of Object.entries(rectangles[side])) {
      const {data}=await worker.recognize(normalized,{rectangle})
      result[field]=normalize(field,data.text)
    }
  } finally { await worker.terminate() }
  if (result.validity) {
    const dates=result.validity.match(/20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g)||[]
    const iso=s=>s.replace(/[.\/]/g,'-').replace(/-(\d)(?=-|$)/g,'-0$1')
    result.validFrom=dates[0]?iso(dates[0]):''
    result.validTo=dates[1]?iso(dates[1]):''
    delete result.validity
  }
  return result
}
