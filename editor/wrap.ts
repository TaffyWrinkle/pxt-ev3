namespace pxt.editor {
    import HF2 = pxt.HF2
    import U = pxt.U

    function log(msg: string) {
        pxt.log("EWRAP: " + msg)
    }

    export interface DirEntry {
        name: string;
        md5?: string;
        size?: number;
    }

    const runTemplate = "C00882010084XX0060640301606400"

    export class Ev3Wrapper {
        msgs = new U.PromiseBuffer<Uint8Array>()
        private cmdSeq = U.randomUint32() & 0xffff;
        private lock = new U.PromiseQueue();
        isStreaming = false;

        constructor(public io: pxt.HF2.PacketIO) {
            io.onData = buf => {
                buf = buf.slice(0, HF2.read16(buf, 0) + 2)
                //log("DATA: " + U.toHex(buf))
                this.msgs.push(buf)
            }
        }

        private allocCore(addSize: number, replyType: number) {
            let len = 5 + addSize
            let buf = new Uint8Array(len)
            HF2.write16(buf, 0, len - 2)  // pktLen
            HF2.write16(buf, 2, this.cmdSeq++) // msgCount
            buf[4] = replyType
            return buf
        }

        private allocSystem(addSize: number, cmd: number, replyType = 1) {
            let buf = this.allocCore(addSize + 1, replyType)
            buf[5] = cmd
            return buf
        }

        runAsync(path: string) {
            let codeHex = runTemplate.replace("XX", U.toHex(U.stringToUint8Array(path)))
            let code = U.fromHex(codeHex)
            let pkt = this.allocCore(2 + code.length, 0)
            HF2.write16(pkt, 5, 0x0800)
            U.memcpy(pkt, 7, code)
            log(`run ${path}`)
            return this.talkAsync(pkt)
                .then(buf => {
                })
        }

        talkAsync(buf: Uint8Array, altResponse = 0) {
            return this.lock.enqueue("talk", () =>
                this.io.sendPacketAsync(buf)
                    .then(() => this.msgs.shiftAsync(1000))
                    .then(resp => {
                        if (resp[2] != buf[2] || resp[3] != buf[3])
                            U.userError("msg count de-sync")
                        if (buf[4] == 1) {
                            if (resp[5] != buf[5])
                                U.userError("cmd de-sync")
                            if (altResponse != -1 && resp[6] != 0 && resp[6] != altResponse)
                                U.userError("cmd error: " + resp[6])
                        }
                        return resp
                    }))
        }

        flashAsync(path: string, file: Uint8Array) {
            log(`write ${file.length} to ${path}`)

            let handle = -1

            let loopAsync = (pos: number): Promise<void> => {
                if (pos >= file.length) return Promise.resolve()
                let size = file.length - pos
                if (size > 1000) size = 1000
                let upl = this.allocSystem(1 + size, 0x93, 0x1)
                upl[6] = handle
                U.memcpy(upl, 6 + 1, file, pos, size)
                return this.talkAsync(upl, 8) // 8=EOF
                    .then(() => loopAsync(pos + size))
            }

            let begin = this.allocSystem(4 + path.length + 1, 0x92)
            HF2.write32(begin, 6, file.length) // fileSize
            U.memcpy(begin, 10, U.stringToUint8Array(path))
            return this.lock.enqueue("file", () =>
                this.talkAsync(begin)
                    .then(resp => {
                        handle = resp[7]
                        return loopAsync(0)
                    }))
        }

        lsAsync(path: string): Promise<DirEntry[]> {
            let lsReq = this.allocSystem(2 + path.length + 1, 0x99)
            HF2.write16(lsReq, 6, 1024) // maxRead
            U.memcpy(lsReq, 8, U.stringToUint8Array(path))

            return this.talkAsync(lsReq, 8)
                .then(resp =>
                    U.uint8ArrayToString(resp.slice(12)).split(/\n/).map(s => {
                        if (!s) return null as DirEntry
                        let m = /^([A-F0-9]+) ([A-F0-9]+) ([^\/]*)$/.exec(s)
                        if (m)
                            return {
                                md5: m[1],
                                size: parseInt(m[2], 16),
                                name: m[3]
                            }
                        else
                            return {
                                name: s.replace(/\/$/, "")
                            }
                    }).filter(v => !!v))
        }

        rmAsync(path: string): Promise<void> {
            log(`rm ${path}`)
            let rmReq = this.allocSystem(path.length + 1, 0x9c)
            U.memcpy(rmReq, 6, U.stringToUint8Array(path))

            return this.talkAsync(rmReq)
                .then(resp => { })
        }

        private streamFileOnceAsync(path: string, cb: (d: Uint8Array) => void) {
            let fileSize = 0
            let filePtr = 0
            let handle = -1
            let resp = (buf: Uint8Array): Promise<void> => {
                if (buf[6] == 2) {
                    // handle not ready - file is missing
                    this.isStreaming = false
                    return Promise.resolve()
                }

                if (buf[6] != 0 && buf[6] != 8)
                    U.userError("bad response when streaming file: " + buf[6] + " " + U.toHex(buf))

                this.isStreaming = true
                fileSize = HF2.read32(buf, 7)
                if (handle == -1) {
                    handle = buf[11]
                    log(`stream on, handle=${handle}`)
                }
                let data = buf.slice(12)
                filePtr += data.length
                if (data.length > 0)
                    cb(data)

                if (buf[6] == 8) {
                    // end of file
                    this.isStreaming = false
                    return this.rmAsync(path)
                }

                let contFileReq = this.allocSystem(1 + 2, 0x97)
                HF2.write16(contFileReq, 7, 1000) // maxRead
                contFileReq[6] = handle
                return Promise.delay(data.length > 0 ? 0 : 500)
                    .then(() => this.talkAsync(contFileReq, -1))
                    .then(resp)
            }

            let getFileReq = this.allocSystem(2 + path.length + 1, 0x96)
            HF2.write16(getFileReq, 6, 1000) // maxRead
            U.memcpy(getFileReq, 8, U.stringToUint8Array(path))
            return this.talkAsync(getFileReq, -1).then(resp)
        }

        streamFileAsync(path: string, cb: (d: Uint8Array) => void) {
            let loop = (): Promise<void> =>
                this.lock.enqueue("file", () =>
                    this.streamFileOnceAsync(path, cb))
                    .then(() => Promise.delay(500))
                    .then(loop)
            return loop()
        }

        private initAsync() {
            return Promise.resolve()
        }

        private resetState() {

        }

        reconnectAsync(first = false): Promise<void> {
            this.resetState()
            if (first) return this.initAsync()
            log(`reconnect`);
            return this.io.reconnectAsync()
                .then(() => this.initAsync())
        }

        disconnectAsync() {
            log(`disconnect`);
            return this.io.disconnectAsync()
        }
    }


}