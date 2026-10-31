'use strict';
const assert=require('node:assert/strict');
const I18N=require('../../static/i18n/i18n.js');
(async()=>{
 let calls=0;
 const fetchFn=async()=>{calls++;if(calls===1)throw new TypeError('network interrupted');return {ok:true,json:async()=>({label:'恢复'})};};
 const [a,b]=await Promise.all([I18N.load('retry-a',{fetchFn,retryDelayMs:0}),I18N.load('retry-a',{fetchFn,retryDelayMs:0})]);
 assert.equal(calls,2);assert.equal(a,b,'concurrent language switches share retries');
 calls=0;
 await assert.rejects(I18N.load('retry-b',{fetchFn:async()=>{calls++;throw new TypeError('offline');},retryDelayMs:0}));
 assert.equal(calls,3,'network retries stop after three attempts');
 calls=0;
 await assert.rejects(I18N.load('retry-c',{fetchFn:async()=>{calls++;return {ok:false,status:404};},retryDelayMs:0}));
 assert.equal(calls,1,'missing language file must not loop');
 console.log('i18n_retry: transient recovery, shared work, bounded failure and permanent failure passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
