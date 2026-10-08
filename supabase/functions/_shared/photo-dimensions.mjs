export function photoDimensions(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>=24&&view.getUint32(0)===0x89504e47&&view.getUint32(4)===0x0d0a1a0a&&view.getUint32(12)===0x49484452)return [view.getUint32(16),view.getUint32(20)];
  if(bytes[0]===255&&bytes[1]===216){
    let i=2;
    while(i+4<=bytes.length){
      if(bytes[i++]!==255)throw Error('Invalid JPEG header.');
      while(bytes[i]===255)i++;
      const marker=bytes[i++];if(marker===0xda||marker===0xd9)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(i+2>bytes.length)break;const length=view.getUint16(i);
      if(length<2||i+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7)return [view.getUint16(i+5),view.getUint16(i+3)];
      i+=length;
    }
  }
  throw Error('Please upload this photo again to normalize it as JPG.');
}
