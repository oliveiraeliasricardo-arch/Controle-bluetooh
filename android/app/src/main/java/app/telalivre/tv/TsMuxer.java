package app.telalivre.tv;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

/**
 * Minimal MPEG-2 Transport Stream (188-byte packet) muxer for hardware H.264 Annex-B frames.
 * Produces DLNA-compatible video/mp2t live streams for Samsung, LG, Sony, TCL and Philips TVs.
 */
public class TsMuxer {

    private static final int PID_PAT = 0x0000;
    private static final int PID_PMT = 0x1000;
    private static final int PID_VIDEO = 0x0100;

    private int patCc = 0;
    private int pmtCc = 0;
    private int videoCc = 0;

    public synchronized void writePatAndPmt(ByteArrayOutputStream out) {
        writePat(out);
        writePmt(out);
    }

    public synchronized byte[] muxVideoFrame(
        byte[] nalBytes,
        long presentationTimeUs,
        boolean isKeyFrame,
        byte[] spsPps
    ) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(nalBytes.length + 1024);

        if (isKeyFrame) {
            writePat(out);
            writePmt(out);
        }

        ByteArrayOutputStream accessUnit = new ByteArrayOutputStream(nalBytes.length + 128);
        // Access Unit Delimiter (AUD) helps hardware TV decoders lock cleanly onto frames
        accessUnit.write(0x00);
        accessUnit.write(0x00);
        accessUnit.write(0x00);
        accessUnit.write(0x01);
        accessUnit.write(0x09);
        accessUnit.write(0xF0);

        if (isKeyFrame && spsPps != null && spsPps.length > 0 && !containsSps(nalBytes)) {
            accessUnit.write(spsPps, 0, spsPps.length);
        }
        accessUnit.write(nalBytes, 0, nalBytes.length);

        byte[] framePayload = accessUnit.toByteArray();
        long pts90k = Math.max(0L, (presentationTimeUs * 90L) / 1000L) & 0x1FFFFFFFFL;

        // 14-byte PES header (video stream 0xE0, unbounded PES length 0x0000, PTS only)
        byte[] pesHeader = new byte[14];
        pesHeader[0] = 0x00;
        pesHeader[1] = 0x00;
        pesHeader[2] = 0x01;
        pesHeader[3] = (byte) 0xE0;
        pesHeader[4] = 0x00;
        pesHeader[5] = 0x00;
        pesHeader[6] = (byte) 0x80;
        pesHeader[7] = (byte) 0x80; // PTS present
        pesHeader[8] = 0x05;        // 5 bytes PTS

        pesHeader[9]  = (byte) (0x21 | (((pts90k >> 30) & 0x07) << 1));
        pesHeader[10] = (byte) ((pts90k >> 22) & 0xFF);
        pesHeader[11] = (byte) (0x01 | (((pts90k >> 15) & 0x7F) << 1));
        pesHeader[12] = (byte) ((pts90k >> 7) & 0xFF);
        pesHeader[13] = (byte) (0x01 | ((pts90k & 0x7F) << 1));

        byte[] pesPacket = new byte[pesHeader.length + framePayload.length];
        System.arraycopy(pesHeader, 0, pesPacket, 0, pesHeader.length);
        System.arraycopy(framePayload, 0, pesPacket, pesHeader.length, framePayload.length);

        int offset = 0;
        boolean firstPacket = true;
        while (offset < pesPacket.length) {
            int remaining = pesPacket.length - offset;
            boolean writePcr = firstPacket && isKeyFrame;
            int minAfBytes = writePcr ? 8 : 0;
            int maxPayload = 184 - minAfBytes;
            int chunk = Math.min(remaining, maxPayload);
            int stuffing = maxPayload - chunk;

            byte[] ts = new byte[188];
            Arrays.fill(ts, (byte) 0xFF);

            int afc = (minAfBytes > 0 || stuffing > 0) ? 0x30 : 0x10;
            ts[0] = 0x47;
            ts[1] = (byte) ((firstPacket ? 0x40 : 0x00) | ((PID_VIDEO >> 8) & 0x1F));
            ts[2] = (byte) (PID_VIDEO & 0xFF);
            ts[3] = (byte) (afc | (videoCc & 0x0F));
            videoCc = (videoCc + 1) & 0x0F;

            int pos = 4;
            if (writePcr) {
                int afLength = 7 + stuffing;
                ts[pos++] = (byte) afLength;
                ts[pos++] = 0x50; // random_access_indicator + PCR_flag
                // 33-bit PCR base + 6 reserved bits + 9-bit PCR extension (0)
                ts[pos++] = (byte) ((pts90k >> 25) & 0xFF);
                ts[pos++] = (byte) ((pts90k >> 17) & 0xFF);
                ts[pos++] = (byte) ((pts90k >> 9) & 0xFF);
                ts[pos++] = (byte) ((pts90k >> 1) & 0xFF);
                ts[pos++] = (byte) (((pts90k & 0x01) << 7) | 0x7E);
                ts[pos++] = 0x00;
                pos += stuffing;
            } else if (stuffing > 0) {
                int afLength = stuffing - 1;
                ts[pos++] = (byte) afLength;
                if (afLength > 0) {
                    ts[pos++] = 0x00; // flags
                    pos += (afLength - 1);
                }
            }

            System.arraycopy(pesPacket, offset, ts, pos, chunk);
            out.write(ts, 0, 188);

            offset += chunk;
            firstPacket = false;
        }

        return out.toByteArray();
    }

    private void writePat(ByteArrayOutputStream out) {
        byte[] ts = new byte[188];
        Arrays.fill(ts, (byte) 0xFF);

        ts[0] = 0x47;
        ts[1] = (byte) (0x40 | ((PID_PAT >> 8) & 0x1F));
        ts[2] = (byte) (PID_PAT & 0xFF);
        ts[3] = (byte) (0x10 | (patCc & 0x0F));
        patCc = (patCc + 1) & 0x0F;

        ts[4] = 0x00; // pointer_field
        ts[5] = 0x00; // table_id = PAT
        ts[6] = (byte) 0xB0;
        ts[7] = 0x0D; // section_length = 13
        ts[8] = 0x00;
        ts[9] = 0x01; // transport_stream_id
        ts[10] = (byte) 0xC1;
        ts[11] = 0x00;
        ts[12] = 0x00;
        // Program 1 -> PMT PID 0x1000
        ts[13] = 0x00;
        ts[14] = 0x01;
        ts[15] = (byte) (0xE0 | ((PID_PMT >> 8) & 0x1F));
        ts[16] = (byte) (PID_PMT & 0xFF);

        int crc = mpeg2Crc32(ts, 5, 12);
        ts[17] = (byte) ((crc >> 24) & 0xFF);
        ts[18] = (byte) ((crc >> 16) & 0xFF);
        ts[19] = (byte) ((crc >> 8) & 0xFF);
        ts[20] = (byte) (crc & 0xFF);

        out.write(ts, 0, 188);
    }

    private void writePmt(ByteArrayOutputStream out) {
        byte[] ts = new byte[188];
        Arrays.fill(ts, (byte) 0xFF);

        ts[0] = 0x47;
        ts[1] = (byte) (0x40 | ((PID_PMT >> 8) & 0x1F));
        ts[2] = (byte) (PID_PMT & 0xFF);
        ts[3] = (byte) (0x10 | (pmtCc & 0x0F));
        pmtCc = (pmtCc + 1) & 0x0F;

        ts[4] = 0x00; // pointer_field
        ts[5] = 0x02; // table_id = PMT
        ts[6] = (byte) 0xB0;
        ts[7] = 0x12; // section_length = 18
        ts[8] = 0x00;
        ts[9] = 0x01; // program_number
        ts[10] = (byte) 0xC1;
        ts[11] = 0x00;
        ts[12] = 0x00;
        // PCR PID = 0x0100
        ts[13] = (byte) (0xE0 | ((PID_VIDEO >> 8) & 0x1F));
        ts[14] = (byte) (PID_VIDEO & 0xFF);
        ts[15] = (byte) 0xF0;
        ts[16] = 0x00; // program_info_length = 0

        // Elementary stream: H.264 AVC (0x1B) on PID 0x0100
        ts[17] = 0x1B;
        ts[18] = (byte) (0xE0 | ((PID_VIDEO >> 8) & 0x1F));
        ts[19] = (byte) (PID_VIDEO & 0xFF);
        ts[20] = (byte) 0xF0;
        ts[21] = 0x00;

        int crc = mpeg2Crc32(ts, 5, 17);
        ts[22] = (byte) ((crc >> 24) & 0xFF);
        ts[23] = (byte) ((crc >> 16) & 0xFF);
        ts[24] = (byte) ((crc >> 8) & 0xFF);
        ts[25] = (byte) (crc & 0xFF);

        out.write(ts, 0, 188);
    }

    private boolean containsSps(byte[] nal) {
        for (int i = 0; i < nal.length - 4; i++) {
            if (nal[i] == 0x00 && nal[i + 1] == 0x00) {
                int scLen = (nal[i + 2] == 0x01) ? 3 : (nal[i + 2] == 0x00 && nal[i + 3] == 0x01 ? 4 : 0);
                if (scLen > 0 && i + scLen < nal.length) {
                    int type = nal[i + scLen] & 0x1F;
                    if (type == 7) return true;
                }
            }
        }
        return false;
    }

    private int mpeg2Crc32(byte[] data, int offset, int length) {
        int crc = 0xFFFFFFFF;
        for (int i = 0; i < length; i++) {
            crc ^= (data[offset + i] & 0xFF) << 24;
            for (int b = 0; b < 8; b++) {
                if ((crc & 0x80000000) != 0) {
                    crc = (crc << 1) ^ 0x04C11DB7;
                } else {
                    crc <<= 1;
                }
            }
        }
        return crc;
    }
}
