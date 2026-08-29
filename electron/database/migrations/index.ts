import type { Migration } from './types'
import { m001InitMigration } from './001_init'
import { m002ScheduleMigration } from './002_schedule'
import { m003ScheduleEndCriteriaMigration } from './003_schedule_end_criteria'
import { m004KnowledgeMigration } from './004_knowledge'
import { m005KnowledgeLinksMigration } from './005_knowledge_links'
import { m006KnowledgeStarMigration } from './006_knowledge_star'
import { m007PageSortOrderMigration } from './007_page_sort_order'
import { m008RecycleBinMigration } from './008_recycle_bin'
import { m009SubtasksMigration } from './009_subtasks'
import { m010KnowledgeCategoryTypeMigration } from './010_knowledge_category_type'
import { m011KnowledgeFileTypeMigration } from './011_knowledge_file_type'
import { m012BlogStatesMigration } from './012_blog_states'
import { m013UserProfileMigration } from './013_user_profile'
import { m014ToolboxMigration } from './014_toolbox'
import { m015DedupEntriesMigration } from './015_dedup_entries'
import { m016BlogStarMigration } from './016_blog_star'
import { m017KnowledgeCategoryDatesMigration } from './017_knowledge_category_dates'
import { m018RepairCategoryDatesMigration } from './018_repair_category_dates'
import { m019NormalizeFileTypeMigration } from './019_normalize_file_type'
import { m020PasswordVaultMigration } from './020_password_vault'
import { m021PasswordAccountMigration } from './021_password_account'
import { m022MomentsMigration } from './022_moments'
import { m023MomentsImageMigration } from './023_moments_image'
import { m024CoverImageMigration } from './024_cover_image'
import { m025MomentsImagesMigration } from './025_moments_images'
import { m026MomentsTagsMigration } from './026_moments_tags'
import { m027MomentsAlbumsMigration } from './027_moments_albums'
import { m028AlbumCoverMigration } from './028_album_cover'
import { m029AlbumCoverRefMigration } from './029_album_cover_ref'
import { m030WeightTrackerMigration } from './030_weight_tracker'
import { m031AttachmentsMigration } from './031_attachments'
import { m032MomentsAttachmentIdsMigration } from './032_moments_attachment_ids'
import { m033BackfillMomentsAttachmentsMigration } from './033_backfill_moments_attachments'
import { m034KnowledgeAttachmentIdMigration } from './034_knowledge_attachment_id'
import { m035AvatarAttachmentMigration } from './035_avatar_attachment'
import { m036KnowledgeSpacesMigration } from './036_knowledge_spaces'
import { m038CheckinModuleMigration } from './038_checkin_module'
import { m039BookmarkNavMigration } from './039_bookmark_nav'
import { m040KnowledgeNetworkMigration } from './040_knowledge_network'
import { m040SuperviseModuleMigration } from './040_supervise_module'
import { m041MomentsShowInTimelineMigration } from './041_moments_show_in_timeline'
import { m042PomodoroSessionsMigration } from './042_pomodoro_sessions'
import { m043BlogTemplatesMigration } from './043_blog_templates'
import { m044PluginAuditLogMigration } from './044_plugin_audit_log'
import { m045McpServersMigration } from './045_mcp_servers'
import { m046AgentSessionsMigration } from './046_agent_sessions'
import { m047KnowledgePackImportsMigration } from './047_knowledge_pack_imports'
import { m048HabitLinksMigration } from './048_habit_links'
import { m049QuizRecordsMigration } from './049_quiz_records'

/**
 * 迁移执行顺序表 —— 顺序即语义，只允许追加，不允许重排或改名。
 *
 * 每个迁移文件只负责自己那一步 DDL / 数据回填，新增迁移请：
 *   1. 在 migrations/ 下新建 NNN_your_migration.ts，导出一个 Migration 对象
 *   2. 把 import 与数组项追加到本文件末尾
 *
 * 注意：name 会落库到 _migrations 表做幂等判定，已发布的名字（含历史编号
 * 重复与跳号，如缺失的 037、两个 040）必须原样保留，否则老库升级会重跑迁移。
 */
export const MIGRATIONS: Migration[] = [
  m001InitMigration,
  m002ScheduleMigration,
  m003ScheduleEndCriteriaMigration,
  m004KnowledgeMigration,
  m005KnowledgeLinksMigration,
  m006KnowledgeStarMigration,
  m007PageSortOrderMigration,
  m008RecycleBinMigration,
  m009SubtasksMigration,
  m010KnowledgeCategoryTypeMigration,
  m011KnowledgeFileTypeMigration,
  m012BlogStatesMigration,
  m013UserProfileMigration,
  m014ToolboxMigration,
  m015DedupEntriesMigration,
  m016BlogStarMigration,
  m017KnowledgeCategoryDatesMigration,
  m018RepairCategoryDatesMigration,
  m019NormalizeFileTypeMigration,
  m020PasswordVaultMigration,
  m021PasswordAccountMigration,
  m022MomentsMigration,
  m023MomentsImageMigration,
  m024CoverImageMigration,
  m025MomentsImagesMigration,
  m026MomentsTagsMigration,
  m027MomentsAlbumsMigration,
  m028AlbumCoverMigration,
  m029AlbumCoverRefMigration,
  m030WeightTrackerMigration,
  m031AttachmentsMigration,
  m032MomentsAttachmentIdsMigration,
  m033BackfillMomentsAttachmentsMigration,
  m034KnowledgeAttachmentIdMigration,
  m035AvatarAttachmentMigration,
  m036KnowledgeSpacesMigration,
  m038CheckinModuleMigration,
  m039BookmarkNavMigration,
  m040KnowledgeNetworkMigration,
  m040SuperviseModuleMigration,
  m041MomentsShowInTimelineMigration,
  m042PomodoroSessionsMigration,
  m043BlogTemplatesMigration,
  m044PluginAuditLogMigration,
  m045McpServersMigration,
  m046AgentSessionsMigration,
  m047KnowledgePackImportsMigration,
  m048HabitLinksMigration,
  m049QuizRecordsMigration,
]
