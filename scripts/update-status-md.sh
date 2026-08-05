#!/bin/bash
# Formül11 — masaüstündeki FORMUL11.md durum dosyasını günlük günceller.
# launchd tarafından her gün otomatik çalıştırılır (bkz. ~/Library/LaunchAgents/com.formul11.daily-status.plist)

set -e
cd /Users/yakupbal/Desktop/Formul11

PROMPT='/Users/yakupbal/Desktop/FORMUL11.md dosyasını güncel proje durumuna göre yeniden yaz. Şunlara bak: bu klasördeki "git log --oneline -20" çıktısı, CLAUDE.md içeriği, ve varsa Firebase/Vercel/GitHub Actions ile ilgili yeni gelişmeler (gh run list --workflow=update-predictions.yml --limit 3 ile pipeline durumunu kontrol edebilirsin). Dosyanın mevcut başlık/bölüm yapısını (Ne bu proje, Canlı adresler, Sosyal medya hesapları, Mimari özet, Bugüne kadar tamamlananlar, Bilinen sınırlamalar / kalan işler, Kullanıcı hakkında) AYNEN koru, sadece içeriği güncel duruma göre güncelle. "Son güncelleme" tarihini bugünün tarihine çevir. Sadece gerçekten değişen/yeni bilgi varsa madde ekle veya kaldır — var olan doğru bilgiyi bozma. İşin bitince sadece "GÜNCELLENDİ" yaz, başka bir şey yazma.'

/opt/homebrew/bin/claude -p "$PROMPT" \
  --permission-mode bypassPermissions \
  >> /Users/yakupbal/Desktop/Formul11/scripts/update-status-md.log 2>&1

echo "$(date): tamamlandı" >> /Users/yakupbal/Desktop/Formul11/scripts/update-status-md.log
