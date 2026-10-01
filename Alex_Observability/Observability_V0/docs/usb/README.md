# USB drive and the run archive

The run archive is one SQLite file. The API does not watch for a USB stick, and it does not compare a stick to the copy on the Pi. Plugging a drive in only matters after it is mounted at a stable path.

Keep the live archive on the Pi. Use the USB stick as a snapshot you take away. The daily job already keeps each robot's older runs when that robot's own history changes, so the file on the SD card is the copy that must stay intact.

A thumb drive is a fine snapshot target. It is a poor place for the live database: cheap flash has the same wear limits as the SD card, and unplugging it while the API is running can leave a half-written file. If the live database should leave the SD card, use a USB SSD that stays plugged in. See [Live database on a drive that stays in](#live-database-on-a-drive-that-stays-in).

Paths below match [RASPBERRY_PI.md](../RASPBERRY_PI.md). Replace `admin` if the Pi login is different.

## What the Pi file already contains

Rows are keyed by robot IP and run id. A daily pass updates runs that robot still reports. It does not delete rows when a robot resets or drops old runs. A later snapshot is often a shorter list than the Pi file. Copying that snapshot back over `run_archive.db` removes robot history that only exists on the Pi, and it can replace a newer note with an older one.

## Insert the stick and take a snapshot

1. Plug the stick into a USB port on the Pi.
2. See which disk just appeared. The SD card is `mmcblk0`. Do not format or mount that.

```bash
lsblk -f
```

3. If the stick has no Linux filesystem yet, format it once. This erases the stick.

```bash
sudo mkfs.ext4 -L fleet-archive /dev/sdX1
```

Use the partition name from `lsblk` (`sda1`, `sdb1`, …). SQLite needs a filesystem with real file locking. ext4 is the right choice. FAT and exFAT are not.

4. Mount it at a fixed path, then give the `admin` user ownership.

```bash
sudo mkdir -p /mnt/fleet-usb
sudo mount /dev/sdX1 /mnt/fleet-usb
sudo chown admin:admin /mnt/fleet-usb
```

5. Stop the API so nothing writes the archive during the copy.

```bash
sudo systemctl stop fleet-manager-api.service
```

6. Write one consistent file onto the stick. `.backup` folds in the WAL side file, so you copy a single database rather than `run_archive.db` plus `run_archive.db-wal`.

```bash
sqlite3 /home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0/backend/run_archive.db \
  ".backup /mnt/fleet-usb/run_archive.db"
```

7. Unmount, then unplug. Start the API again.

```bash
sudo umount /mnt/fleet-usb
sudo systemctl start fleet-manager-api.service
```

Wait until `umount` returns before pulling the stick. If it says the device is busy, the API is still running or a shell is sitting in `/mnt/fleet-usb`.

Check the snapshot on a laptop by mounting the same stick and opening that file:

```bash
sqlite3 /mnt/fleet-usb/run_archive.db "SELECT robot_ip, COUNT(*) FROM archived_runs GROUP BY robot_ip;"
```

## Put an older snapshot back

Stop the API, move the current Pi file aside, then copy the snapshot into the live path with `.backup`. Restart the API. Do this only when the stick is the copy you intend to keep. A stick made last week does not contain runs archived after that, and it does not contain note edits made on the Pi since then.

```bash
sudo systemctl stop fleet-manager-api.service
cd /home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0/backend
mv run_archive.db "run_archive.db.bak-$(date +%Y%m%d)"
rm -f run_archive.db-wal run_archive.db-shm
sqlite3 /mnt/fleet-usb/run_archive.db ".backup run_archive.db"
sudo systemctl start fleet-manager-api.service
```

There is no merge. The app will not insert "runs on the stick that this robot does not have on the Pi" while leaving newer Pi rows in place.

## Live database on a drive that stays in

Use this when a USB SSD remains connected across reboots. The service then opens that file directly and the SD card no longer holds the live archive.

1. Format and mount as above, with a path that will not change, such as `/mnt/fleet-data`.
2. Find the filesystem UUID:

```bash
lsblk -f -o NAME,UUID,LABEL,MOUNTPOINT
```

3. Add one line to `/etc/fstab`. `nofail` lets the Pi boot when the drive is missing. `noatime` skips a metadata write on every read.

```fstab
UUID=paste-the-uuid-here  /mnt/fleet-data  ext4  defaults,nofail,noatime  0  2
```

```bash
sudo mount -a
sudo chown admin:admin /mnt/fleet-data
```

4. Stop the API, place the existing archive on the drive, and point the service at it.

```bash
sudo systemctl stop fleet-manager-api.service
sqlite3 /home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0/backend/run_archive.db \
  ".backup /mnt/fleet-data/run_archive.db"
sudo mkdir -p /etc/systemd/system/fleet-manager-api.service.d
sudo tee /etc/systemd/system/fleet-manager-api.service.d/archive.conf >/dev/null <<'EOF'
[Unit]
RequiresMountsFor=/mnt/fleet-data

[Service]
Environment=RUN_ARCHIVE_DB=/mnt/fleet-data/run_archive.db
EOF
sudo systemctl daemon-reload
sudo systemctl start fleet-manager-api.service
```

`RequiresMountsFor` keeps the API from starting before the drive is mounted. If the drive is absent, `mkdir` in the archive code would otherwise create `/mnt/fleet-data` on the SD card and write a new database there. A later mount would hide that file.

Leave this drive plugged in. To remove it, stop `fleet-manager-api.service`, `umount` the path, then unplug.

## Local testing without a Pi

The same variable accepts any path. No USB and no mount code is involved.

```bash
RUN_ARCHIVE_DB=/tmp/run_archive.db make run-backend
```

The process only sees files on the machine where it is running. A path on the Pi is not visible from a laptop unless the stick is plugged into the laptop or the file has been copied.
