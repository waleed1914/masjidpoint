const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const {getSignedUrl}=require('@aws-sdk/s3-request-presigner');

const rules={
  payment_proof:{max:5242880,mimes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])},
  profile_photo:{max:3145728,mimes:new Set(['image/jpeg','image/png','image/webp'])},
  business_logo:{max:5242880,mimes:new Set(['image/jpeg','image/png','image/webp'])},
  cv:{max:5242880,mimes:new Set(['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])},
  document:{max:10485760,mimes:new Set(['image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])}
};

class PrivateObjectStorage{
  constructor({localDir}={}){
    this.bucket=process.env.OBJECT_STORAGE_BUCKET;
    this.localDir=path.resolve(localDir||path.join(process.cwd(),'data','private-objects'));
    this.client=this.bucket?new S3Client({region:process.env.OBJECT_STORAGE_REGION||'auto',endpoint:process.env.OBJECT_STORAGE_ENDPOINT,forcePathStyle:process.env.OBJECT_STORAGE_FORCE_PATH_STYLE==='true',credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY_ID||'',secretAccessKey:process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY||''}}):null;
  }
  validate(kind,mime,size){const r=rules[kind];if(!r)throw Object.assign(Error('Unsupported document kind.'),{status:400});if(!r.mimes.has(mime))throw Object.assign(Error('This file type is not allowed.'),{status:415});if(size<=0||size>r.max)throw Object.assign(Error(`File exceeds the ${r.max/1048576} MB limit.`),{status:413})}
  async put({kind,ownerType,ownerId,name,mime,buffer}){
    this.validate(kind,mime,buffer.length);
    const id=crypto.randomUUID(),safe=String(name||'document').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100),objectKey=`private/${ownerType}/${encodeURIComponent(ownerId)}/${kind}/${id}-${safe}`,sha256=crypto.createHash('sha256').update(buffer).digest('hex');
    if(this.client)await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:objectKey,Body:buffer,ContentType:mime,ServerSideEncryption:process.env.OBJECT_STORAGE_SSE||'AES256',Metadata:{documentId:id,sha256}}));
    else{const target=path.join(this.localDir,...objectKey.split('/'));await fs.promises.mkdir(path.dirname(target),{recursive:true});await fs.promises.writeFile(target,buffer)}
    return{id,ownerType,ownerId,kind,objectKey,originalName:name,mimeType:mime,size:buffer.length,sha256,storage:this.client?'object':'local'};
  }
  async read(document){
    if(this.client){const result=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:document.objectKey}));return Buffer.from(await result.Body.transformToByteArray())}
    const target=path.resolve(this.localDir,...String(document.objectKey||'').split('/'));
    if(!target.startsWith(this.localDir+path.sep))throw Error('Invalid private object key.');
    return fs.promises.readFile(target);
  }
  async signedRead(key,name){if(!this.client)return null;return getSignedUrl(this.client,new GetObjectCommand({Bucket:this.bucket,Key:key,ResponseContentDisposition:`inline; filename="${String(name).replace(/["\r\n]/g,'_')}"`}),{expiresIn:120})}
  async remove(key){if(this.client)return this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}));const target=path.resolve(this.localDir,...String(key||'').split('/'));if(target.startsWith(this.localDir+path.sep))await fs.promises.unlink(target).catch(()=>{})}
}
module.exports={PrivateObjectStorage,rules};
