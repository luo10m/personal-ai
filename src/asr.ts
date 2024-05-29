import { IAudioRequest } from "./chat";
import pako from 'pako';

const uuid = require('uuid');

const appid = '1351964065';
const token = 'hpq9FUB9LyowvrwM3th4YlM4LvzbOHlR';
const cluster = 'volcengine_input_common';
const audioPath = './wav/rec_out_business.wav'
const audioFormat = 'wav';

const PROTOCOL_VERSION = 0b0001;
const DEFAULT_HEADER_SIZE = 0b0001;

const CLIENT_FULL_REQUEST = 0b0001;
const CLIENT_AUDIO_ONLY_REQUEST = 0b0010;
const SERVER_FULL_RESPONSE = 0b1001;
const SERVER_ACK = 0b1011;
const SERVER_ERROR_RESPONSE = 0b1111;

const NO_SEQUENCE = 0b0000;
const POS_SEQUENCE = 0b0001;
const NEG_SEQUENCE = 0b0010;
const NEG_SEQUENCE_1 = 0b0011;

const NO_SERIALIZATION = 0b0000;
const JSON_SERIALIZATION = 0b0001;
const THRIFT_SERIALIZATION = 0b0011;
const CUSTOM_SERIALIZATION = 0b1111;

const NO_COMPRESSION = 0b0000;
const GZIP_COMPRESSION = 0b0001;
const CUSTOM_COMPRESSION = 0b1111;


const gzipAsync = async (data) => {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const compressed = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(compressed);
};

function generateHeader(options = {}) {
    const {
        version = PROTOCOL_VERSION,
        messageType = CLIENT_FULL_REQUEST,
        messageTypeSpecificFlags = NO_SEQUENCE,
        serializationMethod = JSON_SERIALIZATION,
        compressionType = GZIP_COMPRESSION,
        reservedData = 0x00,
        extensionHeader = new Uint8Array(0),
    } = options;

    const header = new Uint8Array(4 + extensionHeader.length);
    const headerSize = Math.floor(extensionHeader.length / 4) + 1;

    header[0] = (version << 4) | headerSize;
    header[1] = (messageType << 4) | messageTypeSpecificFlags;
    header[2] = (serializationMethod << 4) | compressionType;
    header[3] = reservedData;
    header.set(extensionHeader, 4);

    return header;
}

function parseResponse(res: any): any {
    let buffer: Uint8Array;
    if (res instanceof Uint8Array) {
        buffer = res;
    } else if (typeof res === 'string') {
        console.log('res is string: ', res);
        const encoder = new TextEncoder();
        buffer = encoder.encode(res);
    } else if (res instanceof ArrayBuffer) {
        buffer = new Uint8Array(res);
    } else if (typeof res === 'object' && res.data instanceof ArrayBuffer) {
        buffer = new Uint8Array(res.data);
    } else {
        throw new Error('Unsupported data type');
    }

    const dataView = new DataView(buffer.buffer);

    //console.log("REP: ", res);

    const protocolVersion = dataView.getUint8(0) >> 4;
    const headerSize = dataView.getUint8(0) & 0x0f;
    const messageType = dataView.getUint8(1) >> 4;
    const messageTypeSpecificFlags = dataView.getUint8(1) & 0x0f;
    const serializationMethod = dataView.getUint8(2) >> 4;
    const messageCompression = dataView.getUint8(2) & 0x0f;
    const reserved = dataView.getUint8(3);

    // 提取头部扩展和 payload 数据
    const headerExtensions = buffer.slice(4, headerSize * 4);
    const payload = buffer.slice(headerSize * 4);


    const result: any = {};
    let payloadMsg = null;
    let payloadSize = 0;

    let headerSize2 = headerSize;
    if (messageType === SERVER_FULL_RESPONSE) {
        payloadSize = dataView.getUint32(headerSize2 * 4, true);
        payloadMsg = payload.slice(4);
    } else if (messageType === SERVER_ACK) {
        const seq = dataView.getUint32(headerSize2 * 4, true);
        result.seq = seq;
        if (payload.length >= 8) {
            payloadSize = dataView.getUint32(headerSize2 * 4 + 4, true);
            payloadMsg = payload.slice(8);
        }
    } else if (messageType === SERVER_ERROR_RESPONSE) {
        const code = dataView.getUint32(headerSize2 * 4, true);
        result.code = code;
        payloadSize = dataView.getUint32(headerSize2 * 4 + 4, true);
        payloadMsg = payload.slice(8);
    }

    if (payloadMsg === null) {
        return result;
    }

    if (messageCompression === GZIP_COMPRESSION) {
        const decompressedData = pako.inflate(payloadMsg);
        payloadMsg = new TextDecoder().decode(decompressedData);
    }

    if (serializationMethod === JSON_SERIALIZATION) {
        try {
            payloadMsg = JSON.parse(payloadMsg);
        } catch (error) {
            console.error('Error parsing JSON:', error);
            console.error('Received data:', payloadMsg);
            return { error: 'Invalid JSON data received' };
        }
    } else if (serializationMethod !== NO_SERIALIZATION) {
        payloadMsg = new TextDecoder().decode(payloadMsg);
    }

    result.payloadMsg = payloadMsg;
    result.payloadSize = payloadSize;

    return result;
}


async function getWavInfo(audioFile: File): Promise<{ sampleRate: number; bitsPerSample: number; numChannels: number }> {
    const buffer = await audioFile.arrayBuffer();
    const dataView = new DataView(buffer);

    const sampleRate = dataView.getUint32(24, true);
    const bitsPerSample = dataView.getUint16(34, true);
    const numChannels = dataView.getUint16(22, true);

    return {
        sampleRate,
        bitsPerSample,
        numChannels,
    };
}

class AsrWsClient {
    constructor(cluster, options = {}) {
        this.cluster = cluster;
        this.successCode = options.successCode || 1000;
        this.segDuration = options.segDuration || 15000;
        this.nbest = options.nbest || 1;
        this.appid = options.appid || '1351964065';
        this.token = options.token || 'hpq9FUB9LyowvrwM3th4YlM4LvzbOHlR';
        this.wsUrl = options.wsUrl || 'wss://openspeech.bytedance.com/api/v2/asr';
        this.uid = options.uid || 'streaming_asr_demo';
        this.workflow = options.workflow || 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate';
        this.showLanguage = options.showLanguage || false;
        this.showUtterances = options.showUtterances || false;
        this.resultType = options.resultType || 'full';
        this.format = options.format || 'wav';
        this.rate = options.sampleRate || 16000;
        this.language = options.language || 'zh-CN';
        this.bits = options.bits || 16;
        this.channel = options.channel || 1;
        this.codec = options.codec || 'raw';
        this.audioType = options.audioType || 'local';
        this.secret = options.secret || 'access_secret';
        this.authMethod = options.authMethod || 'token';
        this.mp3SegSize = options.mp3SegSize || 10000;
    }

    constructRequest(reqid) {
        return {
            app: {
                appid: this.appid,
                cluster: this.cluster,
                token: this.token,
            },
            user: {
                uid: this.uid,
            },
            request: {
                reqid,
                nbest: this.nbest,
                workflow: this.workflow,
                show_language: this.showLanguage,
                show_utterances: this.showUtterances,
                result_type: this.resultType,
                sequence: 1,
            },
            audio: {
                format: this.format,
                rate: this.rate,
                language: this.language,
                bits: this.bits,
                channel: this.channel,
                codec: this.codec,
            },
        };
    }

    async *sliceData(data, chunkSize) {
        console.log('ooo');
        // for (let offset = 0; offset < data.length; offset += chunkSize) {
        //     const chunk = data.slice(offset, offset + chunkSize);
        //     console.log('.');
        //     const last = offset + chunkSize >= data.length;
        //     console.log('/');
        //     yield { chunk, last };
        // }
        let offset = 0;
        while (offset < data.length) {
            console.log('oooppp');
            const remaining = data.length - offset;
            const chunk = data.slice(offset, offset + Math.min(chunkSize, remaining));
            const last = offset + chunk.length === data.length;
            if (last) {
                await new Promise((resolve) => resolve());
            }
            offset += chunk.length;
            yield { chunk, last };
        }
    }


    tokenAuth() {
        return { Authorization: `Bearer; ${this.token}` };
    }

    async segmentDataProcessor(audioFile: File, segmentSize: number): Promise<any> {
        const encoder = new TextEncoder();
        const reqid = uuid.v4();
        const requestParams = this.constructRequest(reqid);
        //console.log('\nConstructParams: ', requestParams);

        const jsonString = JSON.stringify(requestParams);
        const jsonBytes = encoder.encode(jsonString);
        const payloadBytes = await gzipAsync(jsonBytes);

        var buffer = new Uint32Array([payloadBytes.length]);
        //console.log("payloadBytes length: ", buffer);
        const view = new DataView(buffer.buffer);
        var bufferBig = view.getUint32(0, false);
        //console.log("payloadBytes - big - length: ", bufferBig.toString(16));
        var b8 = new Uint8Array(4);
        b8[0] = (bufferBig >> 0) & 0xff;
        b8[1] = (bufferBig >> 8) & 0xff;
        b8[2] = (bufferBig >> 16) & 0xff;
        b8[3] = (bufferBig >> 24) & 0xff;


        //console.log("payloadByts length is: ", payloadBytes.length);
        const fullClientRequest = new Uint8Array([
            ...generateHeader(),
            ...b8,
            ...payloadBytes
        ]);
        // console.log('HHH:', fullClientRequest.toString('hex'),
        //     fullClientRequest.length);

        const header = this.tokenAuth();
        console.log('header is: \n', header);
        console.log('Connecting to wss servers...');

        console.log('Connecting to WebSocket server...');
        const ws = new WebSocket(this.wsUrl);

        let result;

        await new Promise((resolve, reject) => {
            ws.onopen = () => {
                console.log('WebSocket connection established.');
                ws.send(JSON.stringify(header));
                ws.send(fullClientRequest);
            };

            ws.onmessage = (event) => {
                console.log('event.data type:', typeof event.data);
                result = parseResponse(event.data);
                if (result.payloadMsg && result.payloadMsg.code !== this.successCode) {
                    console.error('Error response received:', result);
                    ws.close();
                    reject(new Error('Error response received.'));
                } else {
                    console.log('Full client request response received.');
                    resolve(null);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };

            ws.onclose = () => {
                console.log('WebSocket connection closed.');
                resolve(null);
            };
        });


        let seq = 1;
        console.log('Sending audio data...');
        for await (const { chunk, last } of this.sliceData(audioFile, segmentSize)) {
            console.log('YYYYYYYYYY');
            const payloadBytes = await gzipAsync(chunk);

            var buffer = new Uint32Array([payloadBytes.length]);
            console.log("payloadBytes length: ", buffer);
            const view = new DataView(buffer.buffer);
            var bufferBig = view.getUint32(0, false);
            console.log("payloadBytes - big - length: ", bufferBig.toString(16));
            var b8 = new Uint8Array(4);
            b8[0] = (bufferBig >> 0) & 0xff;
            b8[1] = (bufferBig >> 8) & 0xff;
            b8[2] = (bufferBig >> 16) & 0xff;
            b8[3] = (bufferBig >> 24) & 0xff;

            const audioOnlyRequest = new Uint8Array([
                ...generateHeader({
                    messageType: CLIENT_AUDIO_ONLY_REQUEST,
                    messageTypeSpecificFlags: last ? NEG_SEQUENCE : NO_SEQUENCE,
                }),
                ...b8,
                ...payloadBytes,
            ]);

            ws.send(JSON.stringify(header));
            ws.send(audioOnlyRequest);
            console.log("send chunk # ", seq);

            await new Promise((resolve) => {
                ws.onmessage = (data) => {
                    result = parseResponse(data);
                    if (result.payloadMsg && result.payloadMsg.code !== this.successCode) {
                        ws.close();
                        resolve(null);
                    }
                    if (last) {
                        ws.close();
                        resolve(null);
                    }
                };
            });

            seq++;
        }

        return result;
    }

    async execute(audioFile: File): Promise<any> {
        if (this.format === 'mp3') {
            const segmentSize = this.mp3SegSize;
            return await this.segmentDataProcessor(audioFile, segmentSize);
        }

        if (this.format !== 'wav') {
            throw new Error('format should be wav or mp3');
        }

        const { sampleRate, bitsPerSample, numChannels } = await getWavInfo(audioFile);
        const sizePerSec = Math.floor((sampleRate * bitsPerSample * numChannels) / 8);
        const segmentSize = Math.floor((sizePerSec * this.segDuration) / 1000);
        console.log('Wav info: ', sampleRate, bitsPerSample, numChannels,
            sizePerSec, segmentSize
        );

        return await this.segmentDataProcessor(audioFile, segmentSize);
    }
}

const convertAudioToText = async (audioFile: File): Promise<string> => {
    const cluster = 'volcengine_input_common';
    const appid = '1351964065';
    const token = 'hpq9FUB9LyowvrwM3th4YlM4LvzbOHlR';
    const format = 'wav';

    const asrWsClient = new AsrWsClient(cluster, {
        appid,
        token,
        format,
    });

    try {
        const result = await asrWsClient.execute(audioFile);
        console.log('==> executed result:', result);

        // 检查 result.payloadMsg 是否存在以及是否包含 text 属性
        if (result.payloadMsg && result.payloadMsg.text) {
            return result.payloadMsg.text;
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Speech recognition failed:', error);
        throw new Error('Speech recognition failed');
    }
};


export const handleAudioRequest = async (req: IAudioRequest): Promise<string> => {
    const { audioFile } = req;

    // 打印音频文件信息
    console.log("\n\n---------------------------------");
    console.log("Audio file name:", audioFile.name);
    console.log("Audio file size:", audioFile.size);
    console.log("Audio file type:", audioFile.type);

    // 将音频文件转换为文本
    const audioText = await convertAudioToText(audioFile);

    // 返回识别结果
    return audioText;
};
