import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import {uploadPhoto} from '../storage';
import {resolveMediaRefOrThrow} from '../media';
import {isLocalMepPhoto,isManagedMepPhoto} from './media-refs';

const root=()=>{if(!FileSystem.documentDirectory)throw Error('Stockage photo indisponible.');return FileSystem.documentDirectory+'mep-photos-v1/';};
const key=(owner:string,ref:string)=>'mep-photo-v1:'+JSON.stringify([owner,ref]);
type Photo={uri:string;managedRef?:string};
export async function storeMepNativePhoto(owner:string,uri:string,newId:()=>string,size?:{width:number;height:number}){
  const width=size&&size.width>size.height?{width:Math.min(1600,size.width)}:{height:Math.min(1600,size?.height||1600)};
  const prepared=await ImageManipulator.manipulateAsync(uri,[{resize:width}],{compress:.82,format:ImageManipulator.SaveFormat.JPEG});
  const info=await FileSystem.getInfoAsync(prepared.uri);if(!info.exists||info.size>12*1024*1024)throw Error('Photo manquante ou supérieure à 12 Mo.');
  await FileSystem.makeDirectoryAsync(root(),{intermediates:true});const id=newId(),ref='btlocal://'+id,target=root()+id+'.jpg';
  await FileSystem.copyAsync({from:prepared.uri,to:target});await AsyncStorage.setItem(key(owner,ref),JSON.stringify({uri:target}));return ref;
}
async function local(owner:string,ref:string){const value=await AsyncStorage.getItem(key(owner,ref));if(!value)throw Error('Photo locale introuvable. La saisie reste dans la file.');return JSON.parse(value) as Photo;}
export async function uploadMepNativePhoto(owner:string,ref:string,owned:()=>void){
  if(!isLocalMepPhoto(ref))throw Error('Référence photo locale invalide.');const photo=await local(owner,ref);if(photo.managedRef)return photo.managedRef;
  owned();const managedRef=await uploadPhoto(photo.uri,'mep-'+ref.slice(10)+'.jpg');owned();if(!isManagedMepPhoto(managedRef))throw Error('Photo MEP non téléversée. La saisie est conservée.');
  await AsyncStorage.setItem(key(owner,ref),JSON.stringify({...photo,managedRef}));return managedRef;
}
export async function resolveMepNativePhotos(owner:string,refs:string[]){
  if(!Array.isArray(refs)||refs.length>100||refs.some(r=>!isLocalMepPhoto(r)&&!isManagedMepPhoto(r)))throw Error('Photos MEP invalides.');
  const urls:string[]=[];let bytes=0;
  for(const ref of refs){
    let uri:string;
    if(isLocalMepPhoto(ref))uri=(await local(owner,ref)).uri;
    else{const resolved=await resolveMediaRefOrThrow(ref);const filename=root()+owner.replace(/[^a-zA-Z0-9-]/g,'_')+'-'+ref.slice(10)+'-preview.jpg';await FileSystem.makeDirectoryAsync(root(),{intermediates:true});const info=await FileSystem.getInfoAsync(filename);uri=resolved.startsWith('file:')?resolved:info.exists?filename:(await FileSystem.downloadAsync(resolved,filename)).uri;}
    const info=await FileSystem.getInfoAsync(uri);if(!info.exists||info.size>12*1024*1024||(bytes+=info.size)>14*1024*1024)throw Error('Photos trop volumineuses. Réduisez le périmètre.');
    urls.push('data:image/jpeg;base64,'+await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64}));
  }return {urls};
}
