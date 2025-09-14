const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const axios = require("axios");
const qrcode = require("qrcode-terminal");
const translate = require("google-translate-api-x"); // Library untuk terjemahan

const quranApi = "https://equran.id/api/v2";
const MAX_BATCH_SIZE = 10; // Ukuran batch yang lebih kecil untuk performa lebih baik
const BATCH_DELAY_MS = 2000; // Delay antar batch

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

    let sock;
    let isConnected = false;

    const connect = async () => {
        try {
            sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: { level: "silent" } // Mengurangi log yang tidak perlu
            });

            sock.ev.on("creds.update", saveCreds);

            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log("Scan QR Code untuk masuk:");
                    qrcode.generate(qr, { small: true });
                }
                
                if (connection === "open") {
                    isConnected = true;
                    console.log("Bot Quran dan Translator berhasil terhubung!");
                } 
                
                if (connection === "close") {
                    isConnected = false;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    if (statusCode === DisconnectReason.loggedOut) {
                        console.log("Device logged out, silakan scan QR lagi.");
                        process.exit(1);
                    } else {
                        console.log("Koneksi terputus, mencoba menghubungkan ulang...");
                        setTimeout(connect, 5000);
                    }
                }
            });

            sock.ev.on("messages.upsert", async ({ messages }) => {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const senderNumber = msg.key.remoteJid;
                const messageText = msg.message.conversation || 
                                   msg.message.extendedTextMessage?.text || 
                                   msg.message.buttonsResponseMessage?.selectedDisplayText;
                
                if (!messageText) return;

                const command = messageText.toLowerCase().trim().split(" ");
                const mainCommand = command[0];

                try {
                    // Menu
                    if (mainCommand === "/menu" || mainCommand === "!menu" || mainCommand === ".menu") {
                        await sock.sendMessage(senderNumber, { text: 
                            "📖 *Menu Bot Quran dan Translator*\n\n" +
                            "/daftarsurah - Daftar semua surah\n" +
                            "/surah <nomor surah> - Tampilkan seluruh ayat dalam surah (per batch)\n" +
                            "/ayat <nomor surah>:<nomor ayat> - Tampilkan ayat tertentu\n" +
                            "/randomayat - Tampilkan ayat random\n" +
                            "/translate <kode_bahasa> <teks> - Terjemahkan teks\n\n" +
                            "Contoh penggunaan:\n" +
                            "/surah 1\n" +
                            "/ayat 2:255\n" +
                            "/translate id Hello world\n\n" +
                            "Kode bahasa: id (Indonesia), en (Inggris), ar (Arab), dll."
                        });
                    }

                    // Daftar Surah
                    else if (mainCommand === "/daftarsurah") {
                        await sock.sendMessage(senderNumber, { text: "⏳ Sedang mengambil daftar surah..." });
                        
                        try {
                            let response = await axios.get(`${quranApi}/surat`);
                            let surahList = response.data.data;

                            // Kirim daftar surah dalam beberapa bagian
                            let daftarSurah = "";
                            for (let i = 0; i < surahList.length; i++) {
                                const surah = surahList[i];
                                daftarSurah += `${surah.nomor}. ${surah.namaLatin} (${surah.nama})\n`;
                                
                                // Kirim setiap 15 surah untuk menghindari pesan terlalu panjang
                                if ((i + 1) % 15 === 0 || i === surahList.length - 1) {
                                    await sock.sendMessage(senderNumber, { text: `📖 *Daftar Surah (${i-14}-${i+1})*\n\n${daftarSurah}` });
                                    daftarSurah = "";
                                    if (i !== surahList.length - 1) await delay(1000);
                                }
                            }
                        } catch (error) {
                            console.log(error);
                            await sock.sendMessage(senderNumber, { text: "⚠️ Gagal mengambil daftar surah. Silakan coba lagi nanti." });
                        }
                    }

                    // Tampilkan seluruh ayat dalam surah (per batch)
                    else if (mainCommand === "/surah" && command[1]) {
                        let surahNumber = parseInt(command[1]);
                        
                        if (isNaN(surahNumber) || surahNumber < 1 || surahNumber > 114) {
                            await sock.sendMessage(senderNumber, { text: "⚠️ Nomor surah tidak valid. Harap masukkan angka antara 1-114." });
                            return;
                        }
                        
                        await sock.sendMessage(senderNumber, { text: `⏳ Sedang mengambil surah ${surahNumber}...` });

                        try {
                            let response = await axios.get(`${quranApi}/surat/${surahNumber}`);
                            let surahData = response.data.data;

                            if (!surahData || !surahData.ayat) {
                                await sock.sendMessage(senderNumber, { text: "⚠️ Surah tidak ditemukan." });
                                return;
                            }

                            await sock.sendMessage(senderNumber, { 
                                text: `📖 *Surah ${surahData.namaLatin} (${surahData.nama})*\n\n` +
                                      `Jumlah Ayat: ${surahData.jumlahAyat}\n` +
                                      `Tempat Turun: ${surahData.tempatTurun}\n` +
                                      `Arti: "${surahData.arti}"\n\n` +
                                      `Mengirim ayat per batch...`
                            });

                            // Kirim ayat dalam batch
                            for (let i = 0; i < surahData.ayat.length; i += MAX_BATCH_SIZE) {
                                let batch = surahData.ayat.slice(i, i + MAX_BATCH_SIZE);
                                let batchText = "";
                                
                                for (let ayat of batch) {
                                    batchText += `*Ayat ${ayat.nomorAyat}:*\n` +
                                                 `${ayat.teksArab}\n\n` +
                                                 `*Terjemahan:*\n${ayat.teksIndonesia}\n\n` +
                                                 "-----------------\n\n";
                                }
                                
                                await sock.sendMessage(senderNumber, { text: batchText });
                                
                                // Tunggu sebelum mengirim batch berikutnya
                                if (i + MAX_BATCH_SIZE < surahData.ayat.length) {
                                    await delay(BATCH_DELAY_MS);
                                }
                            }
                            
                            await sock.sendMessage(senderNumber, { 
                                text: `✅ Surah ${surahData.namaLatin} selesai dikirim.` 
                            });
                            
                        } catch (error) {
                            console.log(error);
                            await sock.sendMessage(senderNumber, { text: "⚠️ Gagal mengambil surah. Silakan coba lagi nanti." });
                        }
                    }

                    // Tampilkan ayat tertentu
                    else if (mainCommand === "/ayat" && command[1]) {
                        let surahAndAyat = command[1].split(':');
                        if (surahAndAyat.length !== 2) {
                            await sock.sendMessage(senderNumber, { text: "⚠️ Format salah. Gunakan: /ayat <surah>:<ayat>\nContoh: /ayat 2:255" });
                            return;
                        }
                        
                        let surahNumber = parseInt(surahAndAyat[0]);
                        let ayatNumber = parseInt(surahAndAyat[1]);
                        
                        if (isNaN(surahNumber) || surahNumber < 1 || surahNumber > 114) {
                            await sock.sendMessage(senderNumber, { text: "⚠️ Nomor surah tidak valid. Harap masukkan angka antara 1-114." });
                            return;
                        }
                        
                        await sock.sendMessage(senderNumber, { text: `⏳ Sedang mengambil ayat ${surahNumber}:${ayatNumber}...` });

                        try {
                            let response = await axios.get(`${quranApi}/surat/${surahNumber}`);
                            let surahData = response.data.data;

                            if (!surahData || !surahData.ayat) {
                                await sock.sendMessage(senderNumber, { text: "⚠️ Surah tidak ditemukan." });
                                return;
                            }

                            let ayat = surahData.ayat.find(a => a.nomorAyat == ayatNumber);
                            if (!ayat) {
                                await sock.sendMessage(senderNumber, { text: `⚠️ Ayat ${ayatNumber} tidak ditemukan dalam surah ${surahData.namaLatin}.` });
                                return;
                            }

                            let pesan = `📖 *Surah ${surahData.namaLatin} (${surahData.nama}) - Ayat ${ayatNumber}*\n\n` +
                                        `📝 *Teks Arab:*\n${ayat.teksArab}\n\n` +
                                        `🔊 *Latin:*\n${ayat.teksLatin}\n\n` +
                                        `🗨️ *Terjemahan:*\n${ayat.teksIndonesia}\n\n` +
                                        `(Q.S. ${surahData.namaLatin}:${ayatNumber})`;

                            await sock.sendMessage(senderNumber, { text: pesan });
                        } catch (error) {
                            console.log(error);
                            await sock.sendMessage(senderNumber, { text: "⚠️ Gagal mengambil ayat. Silakan coba lagi nanti." });
                        }
                    }

                    // Menampilkan ayat random
                    else if (mainCommand === "/randomayat") {
                        await sock.sendMessage(senderNumber, { text: "⏳ Sedang mencari ayat random..." });
                        
                        try {
                            let randomSurah = Math.floor(Math.random() * 114) + 1;
                            let response = await axios.get(`${quranApi}/surat/${randomSurah}`);
                            let surahData = response.data.data;

                            if (!surahData || !surahData.ayat) {
                                await sock.sendMessage(senderNumber, { text: "⚠️ Surah tidak ditemukan." });
                                return;
                            }

                            let randomAyat = Math.floor(Math.random() * surahData.jumlahAyat) + 1;
                            let ayat = surahData.ayat.find(a => a.nomorAyat == randomAyat);

                            if (!ayat) {
                                await sock.sendMessage(senderNumber, { text: "⚠️ Ayat tidak ditemukan." });
                                return;
                            }

                            let pesan = `🎲 *Ayat Random*\n\n` +
                                        `📖 *Surah ${surahData.namaLatin} (${surahData.nama}) - Ayat ${randomAyat}*\n\n` +
                                        `📝 *Teks Arab:*\n${ayat.teksArab}\n\n` +
                                        `🔊 *Latin:*\n${ayat.teksLatin}\n\n` +
                                        `🗨️ *Terjemahan:*\n${ayat.teksIndonesia}\n\n` +
                                        `(Q.S. ${surahData.namaLatin}:${randomAyat})`;

                            await sock.sendMessage(senderNumber, { text: pesan });
                        } catch (error) {
                            console.log(error);
                            await sock.sendMessage(senderNumber, { text: "⚠️ Gagal mengambil ayat random. Silakan coba lagi nanti." });
                        }
                    }

                    // Fitur Terjemahan
                    else if (mainCommand === "/translate" && command[1] && command[2]) {
                        const targetLang = command[1];
                        const textToTranslate = command.slice(2).join(" ");
                        
                        if (textToTranslate.length > 500) {
                            await sock.sendMessage(senderNumber, { text: "⚠️ Teks terlalu panjang. Maksimal 500 karakter." });
                            return;
                        }

                        await sock.sendMessage(senderNumber, { text: "⏳ Sedang menerjemahkan..." });

                        try {
                            const res = await translate(textToTranslate, { to: targetLang });
                            const translatedText = res.text;
                            
                            await sock.sendMessage(senderNumber, { 
                                text: `🌐 *Hasil Terjemahan* (${targetLang}):\n\n` +
                                      `📝 *Teks Asli:*\n${textToTranslate}\n\n` +
                                      `🔤 *Terjemahan:*\n${translatedText}`
                            });
                        } catch (error) {
                            console.error("Error saat menerjemahkan:", error);
                            await sock.sendMessage(senderNumber, { text: "⚠️ Gagal menerjemahkan teks. Pastikan kode bahasa benar.\n\nContoh: /translate id Hello world" });
                        }
                    }
                    
                    // Bantuan jika command tidak dikenali
                    else {
                        await sock.sendMessage(senderNumber, { text: 
                            "❓ Perintah tidak dikenali. Ketik /menu untuk melihat daftar perintah yang tersedia.\n\n" +
                            "Contoh penggunaan:\n" +
                            "/surah 1 - Menampilkan Surah Al-Fatihah\n" +
                            "/ayat 2:255 - Menampilkan Ayat Kursi\n" +
                            "/translate id Hello world - Menerjemahkan teks ke bahasa Indonesia"
                        });
                    }
                } catch (error) {
                    console.error("Error processing message:", error);
                    await sock.sendMessage(senderNumber, { text: "⚠️ Terjadi kesalahan internal. Silakan coba lagi nanti." });
                }
            });

        } catch (error) {
            console.error("Error in connection:", error);
            setTimeout(connect, 5000);
        }
    };

    connect();
}

// Handle proses agar graceful shutdown
process.on('SIGINT', () => {
    console.log('Bot dimatikan...');
    process.exit(0);
});

startBot().catch(console.error);
