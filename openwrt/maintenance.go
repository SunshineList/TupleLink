// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var releaseTag = regexp.MustCompile(`^openwrt-v([0-9]+\.[0-9]+\.[0-9]+)$`)

// updateRepository 是检查更新与下载安装包时用的仓库。
//
// 这是二次开发分支：面板的「检查更新」必须指向自己的发布页，
// 否则会去拉上游 slobys/NaiLink 的包，把本地改动整个覆盖掉。
// 换仓库时只改这一处，下面的 URL 都由它拼出来。
const updateRepository = "SunshineList/TupleLink"

var dataTag = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$`)

// releases/latest 会把标签塞进跳转地址，这条正则从地址尾部把标签抠出来。
// 走它是因为 api.github.com 对未认证请求按出口 IP 限流（每小时 60 次），
// 家用宽带很容易被别人用光，而 github.com 网页跳转不吃这个配额。
var latestTagPath = regexp.MustCompile(`/releases/tag/([^/?#]+)$`)

type maintenanceJob struct {
	ID      string `json:"id"`
	Action  string `json:"action"`
	State   string `json:"state"`
	Phase   string `json:"phase"`
	Code    string `json:"code,omitempty"`
	Target  string `json:"target,omitempty"`
	Started int64  `json:"started"`
	Updated int64  `json:"updated"`
}
type releaseInfo struct {
	Version string `json:"version"`
	Tag     string `json:"tag"`
	Checked int64  `json:"checked"`
}
type maintenanceStatus struct {
	Success bool            `json:"success"`
	Code    string          `json:"code,omitempty"`
	Current string          `json:"current"`
	Latest  *releaseInfo    `json:"latest,omitempty"`
	Job     *maintenanceJob `json:"job,omitempty"`
	Geodata *releaseInfo    `json:"geodata,omitempty"`
	// Mirror 是当前生效的 GitHub 代理；空串表示直连。
	Mirror string `json:"mirror,omitempty"`
}
type maintenanceManager struct {
	stateDir, configDir, versionFile, lockFile, installLock, initScript string
	mirror                                                              string
	fetch                                                               func(context.Context, string, string, int64) error
	run                                                                 func(context.Context, ...string) ([]byte, error)
	graph                                                               func(context.Context, string, any) error
	tag                                                                 func(context.Context, string) (string, error)
	now                                                                 func() time.Time
}

// 读取 uci daed.main.github_mirror。留空表示直连 github.com。
func readMirror(configDir string) string {
	output, err := exec.Command("uci", "-q", "get", "daed.main.github_mirror").Output()
	if err != nil {
		return ""
	}
	return normaliseMirror(strings.TrimSpace(string(output)))
}

// normaliseMirror 只接受 https 前缀，去掉结尾斜杠。任何解析不了的输入都当没配，
// 免得一个手滑的配置把所有下载都引到别处。
func normaliseMirror(value string) string {
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	return strings.TrimSuffix(parsed.Scheme+"://"+parsed.Host+parsed.Path, "/")
}

func newMaintenance(configDir string) *maintenanceManager {
	m := &maintenanceManager{stateDir: "/var/run/daed-maintenance", configDir: configDir,
		versionFile: "/usr/share/daed-router/version", lockFile: "/var/lock/daed-maintenance.lock",
		installLock: "/var/lock/daed-install.lock", initScript: "/usr/libexec/daed/nailink-maintenance", now: time.Now,
		mirror: readMirror(configDir), run: maintenanceCommand}
	m.fetch = func(ctx context.Context, address, destination string, limit int64) error {
		return maintenanceDownloadVia(ctx, address, destination, limit, m.mirror)
	}
	m.graph = m.graphQL
	m.tag = m.latestTag
	return m
}

// Files are root-owned private state. Never follow pre-existing symlinks.
func privateDirectory(name string) error {
	if err := os.MkdirAll(name, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(name)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("unsafe_directory")
	}
	return nil
}
func readMaintenanceJSON(name string, value any) error {
	info, err := os.Lstat(name)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 32768 {
		return errors.New("unsafe_state")
	}
	data, err := os.ReadFile(name)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}
func writeMaintenanceJSON(name string, value any) error {
	if err := privateDirectory(filepath.Dir(name)); err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(name), ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), name)
}
func maintenanceLock(name string, wait bool) (*os.File, error) {
	// /var/lock is firmware-owned; O_NOFOLLOW rejects a substituted lock file.
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		return nil, err
	}
	fd, err := syscall.Open(name, syscall.O_CREAT|syscall.O_RDWR|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), name)
	flags := syscall.LOCK_EX
	if !wait {
		flags |= syscall.LOCK_NB
	}
	if err = syscall.Flock(fd, flags); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}
func versionNewer(next, current string) bool {
	parse := func(value string) []int {
		value = strings.Split(value, "-")[0]
		parts := strings.Split(value, ".")
		if len(parts) != 3 {
			return nil
		}
		result := make([]int, 3)
		for i, p := range parts {
			n, err := strconv.Atoi(p)
			if err != nil || n < 0 {
				return nil
			}
			result[i] = n
		}
		return result
	}
	a, b := parse(next), parse(current)
	if a == nil {
		return false
	}
	if b == nil {
		return true
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
func (m *maintenanceManager) current() string {
	data, err := os.ReadFile(m.versionFile)
	if err != nil || len(data) > 80 {
		return "unknown"
	}
	value := strings.TrimSpace(string(data))
	if !regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9]+)?$`).MatchString(value) {
		return "unknown"
	}
	return value
}
func (m *maintenanceManager) status() maintenanceStatus {
	s := maintenanceStatus{Success: true, Current: m.current(), Mirror: m.mirror}
	var latest releaseInfo
	if readMaintenanceJSON(filepath.Join(m.stateDir, "latest.json"), &latest) == nil && releaseTag.MatchString(latest.Tag) {
		s.Latest = &latest
	}
	var geo releaseInfo
	if readMaintenanceJSON(filepath.Join(m.configDir, "geodata", "current", "version.json"), &geo) == nil {
		s.Geodata = &geo
	}
	var job maintenanceJob
	if readMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), &job) == nil {
		// An exited/killed worker must never leave an endless spinner. A freshly
		// queued task has a short grace period while procd starts the worker.
		if job.State == "running" || job.State == "queued" && m.now().Unix()-job.Updated > 30 {
			if lock, err := maintenanceLock(m.lockFile, false); err == nil {
				var fresh maintenanceJob
				if readMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), &fresh) == nil && fresh.ID == job.ID && (fresh.State == "running" || fresh.State == "queued" && m.now().Unix()-fresh.Updated > 30) {
					job.State, job.Code, job.Phase = "error", "interrupted", "finished"
					job.Updated = m.now().Unix()
					_ = writeMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), job)
				}
				lock.Close()
			}
		}
		s.Job = &job
	}
	return s
}
func (m *maintenanceManager) save(job *maintenanceJob, phase string) error {
	job.Phase = phase
	job.Updated = m.now().Unix()
	return writeMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), job)
}

func (m *maintenanceManager) start(action string) maintenanceStatus {
	if action != "check" && action != "update" && action != "geodata" {
		return maintenanceStatus{Code: "invalid_action"}
	}
	lock, err := maintenanceLock(m.lockFile, false)
	if err != nil {
		return maintenanceStatus{Code: "busy"}
	}
	defer lock.Close()
	if err = privateDirectory(m.stateDir); err != nil {
		return maintenanceStatus{Code: "unsafe_state"}
	}
	var previous maintenanceJob
	if readMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), &previous) == nil && previous.State == "queued" && m.now().Unix()-previous.Updated < 30 {
		return maintenanceStatus{Code: "busy"}
	}
	job := maintenanceJob{Action: action, State: "queued", Phase: "queued", Started: m.now().Unix()}
	if action == "update" {
		var latest releaseInfo
		if readMaintenanceJSON(filepath.Join(m.stateDir, "latest.json"), &latest) != nil || !releaseTag.MatchString(latest.Tag) || m.now().Unix()-latest.Checked > 3600 || latest.Checked > m.now().Unix()+60 {
			return maintenanceStatus{Code: "check_required"}
		}
		if !versionNewer(latest.Version, m.current()) {
			return maintenanceStatus{Code: "already_latest"}
		}
		if strings.TrimPrefix(latest.Tag, "openwrt-v") != latest.Version {
			return maintenanceStatus{Code: "check_required"}
		}
		job.Target = latest.Tag
	}
	id := make([]byte, 12)
	if _, err = rand.Read(id); err != nil {
		return maintenanceStatus{Code: "state_failed"}
	}
	job.ID = hex.EncodeToString(id)
	if err = m.save(&job, "queued"); err != nil {
		return maintenanceStatus{Code: "state_failed"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err = m.run(ctx, m.initScript, "start", job.ID); err != nil {
		job.State, job.Code = "error", "worker_unavailable"
		_ = m.save(&job, "finished")
		return maintenanceStatus{Code: "worker_unavailable"}
	}
	return maintenanceStatus{Success: true, Current: m.current(), Job: &job}
}
func (m *maintenanceManager) worker(ctx context.Context, expectedID string) error {
	lock, err := maintenanceLock(m.lockFile, true)
	if err != nil {
		return err
	}
	defer lock.Close()
	var job maintenanceJob
	if err = readMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), &job); err != nil || job.State != "queued" || job.ID != expectedID {
		return errors.New("no_queued_job")
	}
	job.State = "running"
	if err = m.save(&job, "checking"); err != nil {
		return err
	}
	switch job.Action {
	case "check":
		err = m.checkRelease(ctx, &job)
	case "update":
		err = m.installUpdate(ctx, &job)
	case "geodata":
		err = m.updateGeodata(ctx, &job)
	default:
		err = errors.New("invalid_action")
	}
	job.State = "success"
	if err != nil {
		job.State = "error"
		job.Code = maintenanceCode(err)
	}
	m.notifyJob(job)
	return m.save(&job, "finished")
}

// notifyJob 把维护任务的结局推给用户。
//
// 只推「用户需要知道结果」的任务：更新和规则库更新都是后台异步跑的，
// 跑完人可能已经离开页面；check 只是查版本，没有推送价值。
//
// 详情只给错误分类码，不给 URL 或异常原文——那些可能带凭据。
// 版式由 notify.sh 统一处理，这里只负责「哪个事件、什么细节」。
//
// 推送在独立进程里跑，失败绝不影响任务结果落盘。
func (m *maintenanceManager) notifyJob(job maintenanceJob) {
	if job.Action != "update" && job.Action != "geodata" {
		return
	}
	// 测试时可以不配，免得单测真的往 Telegram 发请求。
	binary := os.Getenv("DAED_NOTIFY_BIN")
	if binary == "" {
		binary = "/usr/libexec/daed/notify"
	}
	event := job.Action + "_" + job.State
	detail := ""
	if job.State != "success" && job.Code != "" {
		detail = job.Code
	}
	// 用 Background 而不是任务自己的 ctx：任务结束后 ctx 会被取消，
	// 而通知正好是在那个时刻发出的。
	cmd := exec.Command(binary, event, detail)
	cmd.Stdout = nil
	cmd.Stderr = nil
	// 不等待：通知是尽力而为，卡住 8 秒不能拖住任务收尾。
	if err := cmd.Start(); err == nil {
		go func() { _ = cmd.Wait() }()
	}
}
func (m *maintenanceManager) save(job *maintenanceJob, phase string) error {
	job.Phase = phase
	job.Updated = m.now().Unix()
	return writeMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), job)
}
func (m *maintenanceManager) start(action string) maintenanceStatus {
	if action != "check" && action != "update" && action != "geodata" {
		return maintenanceStatus{Code: "invalid_action"}
	}
	lock, err := maintenanceLock(m.lockFile, false)
	if err != nil {
		return maintenanceStatus{Code: "busy"}
	}
	defer lock.Close()
	if err = privateDirectory(m.stateDir); err != nil {
		return maintenanceStatus{Code: "unsafe_state"}
	}
	var previous maintenanceJob
	if readMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), &previous) == nil && previous.State == "queued" && m.now().Unix()-previous.Updated < 30 {
		return maintenanceStatus{Code: "busy"}
	}
	job := maintenanceJob{Action: action, State: "queued", Phase: "queued", Started: m.now().Unix()}
	if action == "update" {
		var latest releaseInfo
		if readMaintenanceJSON(filepath.Join(m.stateDir, "latest.json"), &latest) != nil || !releaseTag.MatchString(latest.Tag) || m.now().Unix()-latest.Checked > 3600 || latest.Checked > m.now().Unix()+60 {
			return maintenanceStatus{Code: "check_required"}
		}
		if !versionNewer(latest.Version, m.current()) {
			return maintenanceStatus{Code: "already_latest"}
		}
		if strings.TrimPrefix(latest.Tag, "openwrt-v") != latest.Version {
			return maintenanceStatus{Code: "check_required"}
		}
		job.Target = latest.Tag
	}
	id := make([]byte, 12)
	if _, err = rand.Read(id); err != nil {
		return maintenanceStatus{Code: "state_failed"}
	}
	job.ID = hex.EncodeToString(id)
	if err = m.save(&job, "queued"); err != nil {
		return maintenanceStatus{Code: "state_failed"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err = m.run(ctx, m.initScript, "start", job.ID); err != nil {
		job.State, job.Code = "error", "worker_unavailable"
		_ = m.save(&job, "finished")
		return maintenanceStatus{Code: "worker_unavailable"}
	}
	return maintenanceStatus{Success: true, Current: m.current(), Job: &job}
}
func (m *maintenanceManager) worker(ctx context.Context, expectedID string) error {
	lock, err := maintenanceLock(m.lockFile, true)
	if err != nil {
		return err
	}
	defer lock.Close()
	var job maintenanceJob
	if err = readMaintenanceJSON(filepath.Join(m.stateDir, "job.json"), &job); err != nil || job.State != "queued" || job.ID != expectedID {
		return errors.New("no_queued_job")
	}
	job.State = "running"
	if err = m.save(&job, "checking"); err != nil {
		return err
	}
	switch job.Action {
	case "check":
		err = m.checkRelease(ctx, &job)
	case "update":
		err = m.installUpdate(ctx, &job)
	case "geodata":
		err = m.updateGeodata(ctx, &job)
	default:
		err = errors.New("invalid_action")
	}
	job.State = "success"
	if err != nil {
		job.State = "error"
		job.Code = maintenanceCode(err)
	}
	m.notifyJob(job)
	return m.save(&job, "finished")
}

func maintenanceCode(err error) string {
	// Only stable codes cross the UI boundary; network/installer errors may
	// contain full URLs, query strings or configuration paths.
	for _, code := range []string{"busy", "download_failed", "invalid_release", "checksum_failed", "invalid_installer", "install_failed", "install_missing", "version_changed", "unsupported", "no_space", "backup_failed", "service_not_ready", "custom_geodata", "invalid_geodata", "apply_failed", "apply_unconfirmed", "rollback_failed", "configuration_modified", "backend_unavailable", "unsafe_state", "state_failed"} {
		if err.Error() == code {
			return code
		}
	}
	return "operation_failed"
}

type githubRelease struct {
	Tag    string `json:"tag_name"`
	Draft  bool   `json:"draft"`
	Assets []struct {
		Name string `json:"name"`
	} `json:"assets"`
}

func (m *maintenanceManager) getJSON(ctx context.Context, address string, value any) error {
	file, err := os.CreateTemp(m.stateDir, ".download-*")
	if err != nil {
		return errors.New("state_failed")
	}
	name := file.Name()
	file.Close()
	defer os.Remove(name)
	if err = m.fetch(ctx, address, name, 4<<20); err != nil {
		return errors.New("download_failed")
	}
	data, err := os.ReadFile(name)
	if err != nil || json.Unmarshal(data, value) != nil {
		return errors.New("invalid_release")
	}
	return nil
}

// latestTag 不去查 api.github.com，而是读 releases/latest 的跳转地址。
// 出口 IP 的 API 配额被用光时，这是唯一还能拿到最新标签的路子。
func (m *maintenanceManager) latestTag(ctx context.Context, repository string) (string, error) {
	var tag string
	err := m.follow(ctx, "https://github.com/"+repository+"/releases/latest", func(request *http.Request) error {
		request.Header.Set("User-Agent", "NaiLink-maintenance")
		return nil
	}, func(response *http.Response) error {
		if response.StatusCode < 300 || response.StatusCode >= 400 {
			return errors.New("invalid_release")
		}
		// 跳转目标必须落在同一个发布仓库里，否则任意跳转都能伪造一个版本号。
		// 镜像会把 Location 改写成 /https://github.com/...，先还原再校验。
		location, err := url.Parse(m.unwrapMirror(response.Header.Get("Location")))
		if err != nil || !maintenanceHostAllowed(location) {
			return errors.New("invalid_release")
		}
		matched := latestTagPath.FindStringSubmatch(location.Path)
		if matched == nil || location.Path != "/"+repository+"/releases/tag/"+matched[1] {
			return errors.New("invalid_release")
		}
		tag = matched[1]
		return nil
	})
	if err != nil {
		return "", err
	}
	return tag, nil
}

// assetsPresent 逐个探测发布资产是否存在。下载通道只认 GET，所以用 GET 拿
// 状态码就断开，不读正文，代价只有一次请求头往返。
func (m *maintenanceManager) assetsPresent(ctx context.Context, tag string) bool {
	for _, name := range []string{"install.sh", "SHA256SUMS", "manifest.tsv"} {
		ok := false
		err := m.follow(ctx, "https://github.com/"+updateRepository+"/releases/download/"+tag+"/"+name,
			func(request *http.Request) error {
				request.Header.Set("User-Agent", "NaiLink-maintenance")
				return nil
			},
			func(response *http.Response) error {
				if response.StatusCode != 200 {
					return errors.New("download_failed")
				}
				ok = true
				return nil
			})
		if err != nil || !ok {
			return false
		}
	}
	return true
}

func (m *maintenanceManager) checkRelease(ctx context.Context, job *maintenanceJob) error {
	var releases []githubRelease
	if err := m.getJSON(ctx, "https://api.github.com/repos/"+updateRepository+"/releases?per_page=10", &releases); err != nil {
		// 出口 IP 的 API 配额被用光时退回跳转标签；资产是否齐全交给
		// 下面按名探测，探测不到就当没有这个版本，不猜。
		tag, fallback := m.tag(ctx, updateRepository)
		if fallback != nil {
			return err
		}
		latest := releaseInfo{}
		if match := releaseTag.FindStringSubmatch(tag); match != nil && m.assetsPresent(ctx, tag) {
			latest = releaseInfo{match[1], tag, m.now().Unix()}
		}
		if latest.Version == "" {
			return errors.New("invalid_release")
		}
		job.Target = latest.Tag
		return writeMaintenanceJSON(filepath.Join(m.stateDir, "latest.json"), latest)
	}
	var latest releaseInfo
	for _, release := range releases {
		match := releaseTag.FindStringSubmatch(release.Tag)
		if release.Draft || match == nil {
			continue
		}
		assets := map[string]bool{}
		for _, asset := range release.Assets {
			assets[asset.Name] = true
		}
		if !assets["install.sh"] || !assets["SHA256SUMS"] || !assets["manifest.tsv"] {
			continue
		}
		if latest.Version == "" || versionNewer(match[1], latest.Version) {
			latest = releaseInfo{match[1], release.Tag, m.now().Unix()}
		}
	}
	if latest.Version == "" {
		return errors.New("invalid_release")
	}
	job.Target = latest.Tag
	return writeMaintenanceJSON(filepath.Join(m.stateDir, "latest.json"), latest)
}
func checksumFor(data []byte, name string) (string, error) {
	found := ""
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || strings.TrimPrefix(fields[1], "*") != name {
			continue
		}
		if found != "" || len(fields[0]) != 64 {
			return "", errors.New("checksum_failed")
		}
		if _, err := hex.DecodeString(fields[0]); err != nil {
			return "", errors.New("checksum_failed")
		}
		found = strings.ToLower(fields[0])
	}
	if found == "" {
		return "", errors.New("checksum_failed")
	}
	return found, nil
}
func verifyChecksum(name, expected string) error {
	file, err := os.Open(name)
	if err != nil {
		return errors.New("checksum_failed")
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil || hex.EncodeToString(hash.Sum(nil)) != expected {
		return errors.New("checksum_failed")
	}
	return nil
}
func (m *maintenanceManager) installUpdate(ctx context.Context, job *maintenanceJob) error {
	if !releaseTag.MatchString(job.Target) || !versionNewer(strings.TrimPrefix(job.Target, "openwrt-v"), m.current()) {
		return errors.New("invalid_release")
	}
	stage, err := os.MkdirTemp(m.stateDir, "install-*")
	if err != nil {
		return errors.New("state_failed")
	}
	defer os.RemoveAll(stage)
	if err = m.save(job, "downloading"); err != nil {
		return errors.New("state_failed")
	}
	base := "https://github.com/" + updateRepository + "/releases/download/" + job.Target + "/"
	for _, name := range []string{"SHA256SUMS", "install.sh"} {
		if err = m.fetch(ctx, base+name, filepath.Join(stage, name), 512<<10); err != nil {
			return errors.New("download_failed")
		}
	}
	if err = m.save(job, "verifying"); err != nil {
		return errors.New("state_failed")
	}
	sums, _ := os.ReadFile(filepath.Join(stage, "SHA256SUMS"))
	digest, err := checksumFor(sums, "install.sh")
	if err != nil {
		return err
	}
	installer := filepath.Join(stage, "install.sh")
	if err = verifyChecksum(installer, digest); err != nil {
		return err
	}
	data, _ := os.ReadFile(installer)
	matches := regexp.MustCompile(`(?m)^release=(openwrt-v[0-9]+\.[0-9]+\.[0-9]+)\r?$`).FindAllSubmatch(data, -1)
	if len(matches) != 1 || string(matches[0][1]) != job.Target {
		return errors.New("invalid_installer")
	}
	if _, err = m.run(ctx, "/bin/sh", "-n", installer); err != nil {
		return errors.New("invalid_installer")
	}
	if err = m.save(job, "installing"); err != nil {
		return errors.New("state_failed")
	}
	if !versionNewer(strings.TrimPrefix(job.Target, "openwrt-v"), m.current()) {
		return errors.New("version_changed")
	}
	output, err := m.run(ctx, "/bin/sh", installer, "--install", "--update-only", "--release", job.Target)
	if err != nil {
		text := string(output)
		for _, item := range []struct{ token, code string }{{"Another NaiLink", "busy"}, {"Existing managed install required", "install_missing"}, {"Online update refused", "version_changed"}, {"Unsupported CPU", "unsupported"}, {"Compatibility check failed", "unsupported"}, {"Supported:", "unsupported"}, {"space", "no_space"}, {"Cannot back up", "backup_failed"}, {"Checksum mismatch", "checksum_failed"}, {"Cannot download", "download_failed"}, {"Management HTTP did not become ready", "service_not_ready"}} {
			if strings.Contains(text, item.token) {
				return errors.New(item.code)
			}
		}
		return errors.New("install_failed")
	}
	if strings.Split(m.current(), "-")[0] != strings.TrimPrefix(job.Target, "openwrt-v") {
		return errors.New("install_failed")
	}
	return nil
}

// 维护通道只认这几个发布主机，跳转也只能停留在这几个主机上。
func maintenanceHostAllowed(u *url.URL) bool {
	if u.Scheme != "https" || u.User != nil || u.Port() != "" && u.Port() != "443" {
		return false
	}
	switch u.Hostname() {
	case "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		return true
	}
	return false
}

// allowedRedirect 判断跳转目标是否可以跟随。没有镜像时只认原始主机；
// 有镜像时还要接受镜像前缀 + 原始地址这种改写形式。
func allowedRedirect(target *url.URL, mirror string) bool {
	if maintenanceHostAllowed(target) {
		return true
	}
	if mirror == "" {
		return false
	}
	prefix := mirror + "/"
	if !strings.HasPrefix(target.String(), prefix) {
		return false
	}
	rest, err := url.Parse(strings.TrimPrefix(target.String(), prefix))
	return err == nil && maintenanceHostAllowed(rest)
}

// 复刻 maintenanceDownload 的传输层设置，但不需要正文，只让调用方看响应头。
func maintenanceRoundTripper() (http.RoundTripper, func()) {
	transport := http.DefaultTransport
	if base, ok := transport.(*http.Transport); ok {
		copied := base.Clone()
		copied.Proxy = nil
		copied.ResponseHeaderTimeout = 20 * time.Second
		copied.TLSHandshakeTimeout = 10 * time.Second
		return copied, copied.CloseIdleConnections
	}
	return transport, func() {}
}

// 把原始地址改写成镜像地址。镜像按「前缀 + 完整原始 URL」转发，
// 例如 https://mirror.example/https://github.com/owner/repo/releases/download/v1/x。
func (m *maintenanceManager) mirrorURL(address string) string {
	if m.mirror == "" {
		return address
	}
	return m.mirror + "/" + address
}

// unwrapMirror 把镜像改写过的跳转目标还原成原始地址。实测镜像把 Location
// 写成相对路径 /https://github.com/...，也可能写成完整前缀形式或原样透传，
// 三种都要能还原，否则合法的发布跳转会被当成伪造而拒绝。
func (m *maintenanceManager) unwrapMirror(location string) string {
	if m.mirror == "" {
		return location
	}
	if rest, ok := strings.CutPrefix(location, m.mirror+"/"); ok {
		return rest
	}
	// 相对路径：去掉开头的斜杠后若本身就是一个 https 地址，那就是被改写的原始目标。
	if rest, ok := strings.CutPrefix(location, "/"); ok && strings.HasPrefix(rest, "https://") {
		return rest
	}
	return location
}

// follow 发一次请求并把响应头和状态码交给 inspect，但不跟随跳转、不读正文。
func (m *maintenanceManager) follow(ctx context.Context, address string, prepare func(*http.Request) error, inspect func(*http.Response) error) error {
	parsed, err := url.Parse(address)
	if err != nil || !maintenanceHostAllowed(parsed) {
		return errors.New("download_failed")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	transport, closeIdle := maintenanceRoundTripper()
	defer closeIdle()
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		// 要的就是这第一条跳转，别的都不要跟。
		return http.ErrUseLastResponse
	}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, m.mirrorURL(address), nil)
	if err != nil {
		return err
	}
	if err = prepare(request); err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	return inspect(response)
}

func maintenanceDownload(ctx context.Context, address, destination string, limit int64) error {
	return maintenanceDownloadVia(ctx, address, destination, limit, "")
}

// maintenanceDownloadVia 与 maintenanceDownload 相同，但可经镜像转发。
// 校验始终针对原始 github 地址，镜像只作为请求前缀出现，
// 这样镜像站换域名也不会放宽真正允许下载的主机集合。
func maintenanceDownloadVia(ctx context.Context, address, destination string, limit int64, mirror string) error {
	allowed := maintenanceHostAllowed
	parsed, err := url.Parse(address)
	if err != nil || !allowed(parsed) {
		return errors.New("download_failed")
	}
	target := address
	if mirror != "" {
		target = mirror + "/" + address
	}
	ctx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()
	transport := http.DefaultTransport
	if base, ok := transport.(*http.Transport); ok {
		copy := base.Clone()
		copy.Proxy = nil
		copy.ResponseHeaderTimeout = 20 * time.Second
		copy.TLSHandshakeTimeout = 10 * time.Second
		transport = copy
		defer copy.CloseIdleConnections()
	}
	client := &http.Client{Transport: transport, Timeout: 180 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) > 5 || !allowedRedirect(r.URL, mirror) {
			return errors.New("redirect_rejected")
		}
		return nil
	}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "NaiLink-maintenance")
	request.Header.Set("Accept", "application/vnd.github+json")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.ContentLength > limit {
		return errors.New("download_failed")
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	size, err := io.Copy(file, io.LimitReader(response.Body, limit+1))
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil || size == 0 || size > limit {
		os.Remove(destination)
		return errors.New("download_failed")
	}
	return nil
}

type boundedOutput struct{ data []byte }

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if len(p) >= 65536 {
		b.data = append(b.data[:0], p[len(p)-65536:]...)
	} else {
		if len(b.data)+len(p) > 65536 {
			copy(b.data, b.data[len(b.data)+len(p)-65536:])
			b.data = b.data[:65536-len(p)]
		}
		b.data = append(b.data, p...)
	}
	return n, nil
}
func maintenanceCommand(ctx context.Context, args ...string) ([]byte, error) {
	if len(args) == 0 {
		return nil, errors.New("empty_command")
	}
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	var out boundedOutput
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.data, err
}
func (m *maintenanceManager) graphQL(ctx context.Context, query string, value any) error {
	identity, err := readCredentials(m.configDir)
	if err != nil {
		return errors.New("backend_unavailable")
	}
	target, err := backendURL()
	if err != nil {
		return errors.New("backend_unavailable")
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": identity.Username, "role": "admin", "exp": m.now().Add(time.Minute).Unix()}).SignedString([]byte(identity.Secret))
	if err != nil {
		return errors.New("backend_unavailable")
	}
	body, _ := json.Marshal(map[string]string{"query": query})
	request, err := http.NewRequestWithContext(ctx, "POST", target.String()+"/graphql", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := (&http.Client{Timeout: 45 * time.Second, Transport: &http.Transport{Proxy: nil}}).Do(request)
	if err != nil {
		return errors.New("backend_unavailable")
	}
	defer response.Body.Close()
	var envelope struct {
		Data   json.RawMessage   `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&envelope) != nil {
		return errors.New("backend_unavailable")
	}
	if len(envelope.Errors) > 0 {
		return errors.New("apply_failed")
	}
	if len(envelope.Data) == 0 {
		return errors.New("backend_unavailable")
	}
	if err = json.Unmarshal(envelope.Data, value); err != nil {
		return errors.New("backend_unavailable")
	}
	return nil
}

func maintenanceCLI(command, configDir, jobID string) {
	debug.SetMemoryLimit(64 << 20)
	if os.Geteuid() != 0 {
		json.NewEncoder(os.Stdout).Encode(maintenanceStatus{Code: "permission_denied"})
		return
	}
	manager := newMaintenance(configDir)
	switch command {
	case "status":
		json.NewEncoder(os.Stdout).Encode(manager.status())
	case "check", "update", "geodata":
		json.NewEncoder(os.Stdout).Encode(manager.start(command))
	case "worker":
		if !regexp.MustCompile(`^[a-f0-9]{24}$`).MatchString(jobID) {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
		defer cancel()
		if err := manager.worker(ctx, jobID); err != nil {
			// 错误码是脱敏后给 UI 的；具体原因只写进 root 可读的日志，
			// 否则用户看到 download_failed 之后完全无从下手。
			fmt.Fprintln(os.Stderr, "NaiLink maintenance worker stopped:", err)
		}
	default:
		json.NewEncoder(os.Stdout).Encode(maintenanceStatus{Code: "invalid_action"})
	}
}
