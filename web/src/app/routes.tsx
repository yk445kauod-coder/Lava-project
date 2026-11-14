import { lazy } from "react";
import { Outlet, type RouteObject } from "react-router-dom";

import RouteError from "../components/RouteError";
import Landing from "../pages/Landing/Landing";

const Login = lazy(() => import("../pages/Login/Login"));
const About = lazy(() => import("../pages/About/About"));
const Dashboard = lazy(() => import("../pages/Dashboard/Dashboard"));
const Chat = lazy(() => import("../pages/Chat/Chat"));
const Explorer = lazy(() => import("../pages/Explorer/Explorer"));
const Experiments = lazy(() => import("../pages/Experiments/Experiments"));
const Datasets = lazy(() => import("../pages/Datasets/Datasets"));
const Coverage = lazy(() => import("../pages/Coverage/Coverage"));
const Relevance = lazy(() => import("../pages/Relevance/Relevance"));
const Safety = lazy(() => import("../pages/Safety/Safety"));
const Insights = lazy(() => import("../pages/Insights/Insights"));
const Reports = lazy(() => import("../pages/Reports/Reports"));
const Rank = lazy(() => import("../pages/Rank/Rank"));
const Compare = lazy(() => import("../pages/Compare/Compare"));
const Search = lazy(() => import("../pages/Search/Search"));

export const routes: RouteObject[] = [
  {
    // A layout route so one errorElement catches failures from every child,
    // including a lazy chunk that fails to import.
    path: "/",
    element: <Outlet />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Landing /> },
      { path: "login", element: <Login /> },
      { path: "about", element: <About /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "chat", element: <Chat /> },
      { path: "explorer", element: <Explorer /> },
      { path: "experiments", element: <Experiments /> },
      { path: "datasets", element: <Datasets /> },
      { path: "coverage", element: <Coverage /> },
      { path: "relevance", element: <Relevance /> },
      { path: "safety", element: <Safety /> },
      { path: "insights", element: <Insights /> },
      { path: "reports", element: <Reports /> },
      { path: "rank", element: <Rank /> },
      { path: "compare", element: <Compare /> },
      { path: "search", element: <Search /> },
    ],
  },
];
