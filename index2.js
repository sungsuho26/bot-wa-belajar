const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const axios = require("axios");
const qrcode = require("qrcode-terminal");
const translate = require("google-translate-api-x"); // Library untuk terjemahan

const quranApi = "https://equran.id/api/v2";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

    let sock;

    const connect = async () => {
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", (update) => {
            const { connection, qr } = update;
            if (qr) {
                console.log("Scan QR Code untuk masuk:");
                qrcode.generate(qr, { small: true });
            }
            if (connection === "open") {
                console.log("Bot Quran dan Translator berhasil terhubung!");
            } else if (connection === "close") {
                console.log("Koneksi terputus, mencoba menghubungkan ulang...");
                setTimeout(connect, 5000); // Coba hubungkan ulang setelah 5 detik
            }
        });

        sock.ev.on("messages.upsert", async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message) return;

            const senderNumber = msg.key.remoteJid;
            const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;
            const command = messageText?.toLowerCase().split(" ");

            if (!command) return;

            // Menu
            if (command[0] === "/menu") {
                await sock.sendMessage(senderNumber, { text: 
                    "📖 *Menu Bot Quran dan Translator*\n\n" +
                    "/daftarsurah - Daftar semua surah\n" +
                    "/surah <nomor surah> - Tampilkan seluruh ayat dalam surah (per batch)\n" +
                    "/ayat <nomor surah> <nomor ayat> - Tampilkan ayat tertentu\n" +
                    "/randomayat - Tampilkan ayat random\n" +
                    "/translate <bahasa_target> <teks> - Terjemahkan teks\n"
                });
            }

            // Daftar Surah
            else if (command[0] === "/daftarsurah") {
                try {
                    let response = await axios.get(`${quranApi}/surat`);
                    let surahList = response.data.data;

                    let daftarSurah = surahList.map(surah => {
                        return `${surah.nomor}. ${surah.namaLatin} (${surah.nama})`;
                    }).join("\n");

                    await sock.sendMessage(senderNumber, { text: `📖 *Daftar Surah*\n\n${daftarSurah}` });
                } catch (error) {
                    console.log(error);
                    await sock.sendMessage(senderNumber, { text: "⚠️ Gagal mengambil daftar surah." });
                }
            }

            // Tampilkan seluruh ayat dalam surah (per batch)
            else if (command[0] === "/surah" && command[1]) {
                let surahNumber = command[1];

                try {
                    let response = await axios.get(`${quranApi}/surat/${surahNumber}`);
                    let surahData = response.data.data;

                    if (!surahData || !surahData.ayat) {
                        await sock.sendMessage(senderNumber, { text: "⚠️ Surah tidak ditemukan." });
                        return;
                    }

                    // Jika surah memiliki lebih dari 50 ayat, kirim per batch
                    if (surahData.jumlahAyat > 50) {
                        await sock.sendMessage(senderNumber, { text: `📖 *Surah ${surahData.namaLatin} (${surahData.nama})*\n\nSurah ini memiliki ${surahData.jumlahAyat} ayat. Mengirim ayat per batch...` });

                        // Kirim ayat dalam batch (misalnya 10 ayat per pesan)
                        let ayatList = surahData.ayat.map((ayat, index) => {
                            let arabicText = ayat.teksArab;
                            let terjemahan = ayat.teksIndonesia;

                            return `📖 *Ayat ${index + 1}*\n\n📝 *Teks Arab:* \n${arabicText}\n\n🗨️ *Terjemahan:* \n${terjemahan}`;
                        });

                        for (let i = 0; i < ayatList.length; i += 10) {
                            let batch = ayatList.slice(i, i + 10).join("\n\n-----------------\n\n");
                            await sock.sendMessage(senderNumber, { text: `📖 *Batch ${Math.floor(i / 10) + 1}*\n\n${batch}` });

                            // Tunggu 2 detik sebelum mengirim batch berikutnya
                            if (i + 10 < ayatList.length) {
                                await new Promise(resolve => setTimeout(resolve, 2000));
                            }
                        }
                    } else {
                        // Jika surah pendek, kirim semua ayat sekaligus
                        let ayatList = surahData.ayat.map((ayat, index) => {
                            let arabicText = ayat.teksArab;
                            let terjemahan = ayat.teksIndonesia;

                            return `📖 *Ayat ${index + 1}*\n\n📝 *Teks Arab:* \n${arabicText}\n\n🗨️ *Terjemahan:* \n${terjemahan}`;
                        }).join("\n\n-----------------\n\n");

                        await sock.sendMessage(senderNumber, { text: `📖 *Surah ${surahData.namaLatin} (${surahData.nama})*\n\n${ayatList}` });
                    }
                } catch (error) {
                    console.log(error);
                    await sock.sendMessage(senderNumber, { text: "⚠️ Surah tidak ditemukan atau terjadi kesalahan." });
                }
            }

            // Tampilkan ayat tertentu
            else if (command[0] === "/ayat" && command[1] && command[2]) {
                let surahNumber = command[1];
                let ayatNumber = command[2];

                try {
                    let response = await axios.get(`${quranApi}/surat/${surahNumber}`);
                    let surahData = response.data.data;

                    if (!surahData || !surahData.ayat) {
                        await sock.sendMessage(senderNumber, { text: "⚠️ Surah tidak ditemukan." });
                        return;
                    }

                    let ayat = surahData.ayat.find(a => a.nomorAyat == ayatNumber);
                    if (!ayat) {
                        await sock.sendMessage(senderNumber, { text: "⚠️ Ayat tidak ditemukan." });
                        return;
                    }

                    let arabicText = ayat.teksArab;
                    let terjemahan = ayat.teksIndonesia;

                    let pesan = `📖 *Surah ${surahData.namaLatin} (${surahData.nama}) - Ayat ${ayatNumber}*\n\n` +
                        `📝 *Teks Arab:* \n${arabicText}\n\n` +
                        `🗨️ *Terjemahan:* \n${terjemahan}\n\n(Q.S. ${surahData.namaLatin}:${ayatNumber})`;

                    await sock.sendMessage(senderNumber, { text: pesan });
                } catch (error) {
                    console.log(error);
                    await sock.sendMessage(senderNumber, { text: "⚠️ Ayat tidak ditemukan atau terjadi kesalahan." });
                }
            }

            // Menampilkan ayat random
            else if (command[0] === "/randomayat") {
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

                    let arabicText = ayat.teksArab;
                    let terjemahan = ayat.teksIndonesia;

                    let pesan = `📖 *Ayat Random dari Surah ${surahData.namaLatin}*\n\n` +
                        `📝 *Teks Arab:* \n${arabicText}\n\n` +
                        `🗨️ *Terjemahan:* \n${terjemahan}\n\n(Q.S. ${surahData.namaLatin}:${randomAyat})`;

                    await sock.sendMessage(senderNumber, { text: pesan });
                } catch (error) {
                    console.log(error);
                    await sock.sendMessage(senderNumber, { text: "⚠️ Terjadi kesalahan atau ayat tidak ditemukan." });
                }
            }

            // Fitur Terjemahan
            else if (command[0] === "/translate" && command[1] && command[2]) {
                const targetLang = command[1];
                const textToTranslate = command.slice(2).join(" ");

                try {
                    const res = await translate(textToTranslate, { to: targetLang });
                    const translatedText = res.text;
                    await sock.sendMessage(senderNumber, { text: `Terjemahan: ${translatedText}` });
                } catch (error) {
                    console.error("Error saat menerjemahkan:", error);
                    await sock.sendMessage(senderNumber, { text: "⚠️ Gagal menerjemahkan teks. Silakan coba lagi." });
                }
            }
        });
    };

    connect();
}

startBot();
