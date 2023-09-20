import { request_content_length, request_stream } from '../Request';
import { LiveStream, Stream } from './classes/LiveStream';
import { SeekStream } from './classes/SeekStream';
import { FormatData, InfoData, StreamInfoData } from './utils/constants';
import { video_stream_info } from './utils/extractor';
import { URL } from 'node:url';

export enum StreamType {
    Arbitrary = 'arbitrary',
    Raw = 'raw',
    OggOpus = 'ogg/opus',
    WebmOpus = 'webm/opus',
    Opus = 'opus'
}

export interface StreamOptions {
    seek?: number;
    quality?: number;
    language?: string;
    htmldata?: boolean;
    precache?: number;
    discordPlayerCompatibility?: boolean;
}

interface AudioFormat extends FormatData {
    codec: string;
    container: string;
}

/**
 * Command to find audio formats from given format array
 * @param formats Formats to search from
 * @returns Audio Formats array
 */
export function parseAudioFormats(formats: FormatData[]): AudioFormat[] {
    return formats.flatMap((format) => {
        const type = format.mimeType;
        if (!type.startsWith('audio')) return [];
        return [{
            codec: type.split('codecs="')[1].split('"')[0],
            container: type.split('audio/')[1].split(';')[0],
            ...format,
        }];
    });
}
/**
 * Type for YouTube Stream
 */
export type YouTubeStream = Stream | LiveStream | SeekStream;
/**
 * Stream command for YouTube
 * @param url YouTube URL
 * @param options lets you add quality for stream
 * @returns Stream class with type and stream for playing.
 */
export async function stream(url: string, options: StreamOptions = {}): Promise<YouTubeStream> {
    const info = await video_stream_info(url, { htmldata: options.htmldata, language: options.language });
    return await stream_from_info(info, options);
}
/**
 * Stream command for YouTube using info from video_info or decipher_info function.
 * @param info video_info data
 * @param options lets you add quality for stream
 * @returns Stream class with type and stream for playing.
 */
export async function stream_from_info(
    info: InfoData | StreamInfoData,
    options: StreamOptions = {}
): Promise<YouTubeStream> {
    if (info.format.length === 0)
        throw new Error('Upcoming and premiere videos that are not currently live cannot be streamed.');
    if (options.quality && !Number.isInteger(options.quality))
        throw new Error("Quality must be set to an integer.")

    if (
        info.LiveStreamData.isLive === true &&
        info.LiveStreamData.dashManifestUrl !== null &&
        info.video_details.durationInSec === 0
    ) {
        return new LiveStream(
            info.format[info.format.length - 1],
            info.LiveStreamData.dashManifestUrl,
            info.video_details.url,
            options.precache
        );
    }

    const audioFormat = parseAudioFormats(info.format);
    if (typeof options.quality !== 'number') options.quality = audioFormat.length - 1;
    else if (options.quality <= 0) options.quality = 0;
    else if (options.quality >= audioFormat.length) options.quality = audioFormat.length - 1;
    const final: FormatData & Partial<AudioFormat> = audioFormat.length !== 0 ? audioFormat[options.quality] : info.format[info.format.length - 1];
    let type: StreamType =
        final.codec === 'opus' && final.container === 'webm' ? StreamType.WebmOpus : StreamType.Arbitrary;
    await request_stream(`https://${new URL(final.url).host}/generate_204`);
    if (type === StreamType.WebmOpus) {
        if (!options.discordPlayerCompatibility) {
            options.seek ??= 0;
            if (options.seek >= info.video_details.durationInSec || options.seek < 0)
                throw new Error(`Seeking beyond limit. [ 0 - ${info.video_details.durationInSec - 1}]`);
            return new SeekStream(
                final,
                info.video_details.durationInSec,
                Number(final.indexRange.end),
                Number(final.contentLength),
                Number(final.bitrate),
                info.video_details.url,
                options
            );
        } else if (options.seek) throw new Error('Can not seek with discordPlayerCompatibility set to true.');
    }

    let contentLength;
    if (final.contentLength) {
        contentLength = Number(final.contentLength);
    } else {
        contentLength = await request_content_length(final.url);
    }

    return new Stream(
        final,
        type,
        info.video_details.durationInSec,
        contentLength,
        info.video_details.url,
        options
    );
}
