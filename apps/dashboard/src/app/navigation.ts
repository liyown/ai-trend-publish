import type React from "react";
import {
  Cable,
  FileArchive,
  Fingerprint,
  Gauge,
  ListChecks,
  ListTodo,
  Newspaper,
  LibraryBig,
  PackageOpen,
  RadioTower,
  Settings,
} from "lucide-react";

export type DashboardRoute =
  | "/workspace"
  | "/automations"
  | "/identities"
  | "/knowledge"
  | "/sources"
  | "/content-plans"
  | "/publishing"
  | "/jobs"
  | "/library"
  | "/connections"
  | "/settings";

export type NavItem = {
  to: DashboardRoute;
  label: string;
  description: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
};

export type NavDomain = {
  id: "today" | "content" | "publish" | "records" | "system";
  label: string;
  shortLabel: string;
  description: string;
  intent: string;
  icon: React.ComponentType<{ className?: string }>;
  items: readonly NavItem[];
};

export const navDomains = [
  {
    id: "today",
    label: "工作台",
    shortLabel: "台",
    description: "当前行动",
    intent: "开始内容任务。",
    icon: Gauge,
    items: [
      {
        to: "/automations",
        label: "任务",
        description: "内容与发布编排",
        detail: "选择内容方案、发布目标和触发方式。",
        icon: ListTodo,
      },
      {
        to: "/workspace",
        label: "今天",
        description: "下一步行动",
        detail: "查看准备度和最近运行。",
        icon: Gauge,
      },
    ],
  },
  {
    id: "content",
    label: "内容准备",
    shortLabel: "内容",
    description: "身份、素材与预设",
    intent: "维护稳定内容输入。",
    icon: Newspaper,
    items: [
      {
        to: "/identities",
        label: "内容身份",
        description: "定位与语气",
        detail: "维护定位、受众、语气和表达边界。",
        icon: Fingerprint,
      },
      {
        to: "/knowledge",
        label: "知识库",
        description: "参考资料",
        detail: "上传并维护内容生产所需的长期参考材料。",
        icon: LibraryBig,
      },
      {
        to: "/sources",
        label: "抓取数据源",
        description: "动态数据输入",
        detail: "维护运行时需要抓取的网页和数据来源。",
        icon: Newspaper,
      },
      {
        to: "/content-plans",
        label: "内容方案",
        description: "固定流程与插件",
        detail: "分步组合身份、知识库、抓取源、插件和发布配置。",
        icon: ListChecks,
      },
    ],
  },
  {
    id: "publish",
    label: "发布",
    shortLabel: "发布",
    description: "账号与目标",
    intent: "管理渠道和扇出关系。",
    icon: RadioTower,
    items: [
      {
        to: "/publishing",
        label: "渠道与目标",
        description: "身份 + 账号",
        detail: "维护渠道账号与发布目标。",
        icon: RadioTower,
      },
    ],
  },
  {
    id: "records",
    label: "记录",
    shortLabel: "记录",
    description: "任务与成品",
    intent: "查看可靠执行和内容资产。",
    icon: PackageOpen,
    items: [
      {
        to: "/jobs",
        label: "运行记录",
        description: "执行状态与检查点",
        detail: "查看每次运行的状态、失败原因与恢复操作。",
        icon: PackageOpen,
      },
      {
        to: "/library",
        label: "内容包",
        description: "成品与发布",
        detail: "查看渠道无关的内容包并发布。",
        icon: FileArchive,
      },
    ],
  },
  {
    id: "system",
    label: "设置",
    shortLabel: "设置",
    description: "连接与架构",
    intent: "维护外部能力和扩展。",
    icon: Settings,
    items: [
      {
        to: "/connections",
        label: "连接",
        description: "外部服务能力",
        detail: "维护模型、图片、通知和渠道 API 连接。",
        icon: Cable,
      },
      {
        to: "/settings",
        label: "运行架构",
        description: "扩展注册",
        detail: "查看流水线、插件和渠道适配器。",
        icon: Settings,
      },
    ],
  },
] as const satisfies readonly NavDomain[];

export const navItems: NavItem[] = navDomains.flatMap((domain) => [...domain.items]);

export function activeNavigation(pathname: string): { domain: NavDomain; item: NavItem } {
  const item = navItems.find((candidate) => pathname.startsWith(candidate.to)) ?? navItems[0];
  const domain =
    navDomains.find((candidate) => candidate.items.some((value) => value.to === item.to)) ??
    navDomains[0];
  return { domain, item };
}
