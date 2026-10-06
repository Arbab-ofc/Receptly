import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Empty } from './ui';
import { activityPoints, type AnalyticsData } from '../lib/analytics';
export default function ActivityChart({
  data,
  range = '7d',
}: {
  data?: AnalyticsData;
  range?: string;
}) {
  const points = activityPoints(data, range);
  if (!data || !points.some((point) => point.incoming || point.autoReplies || point.manualReplies))
    return (
      <Empty
        title="No message activity in this period"
        description="Activity will appear after messages arrive. Reporting periods use UTC; your business schedule uses your configured timezone."
      />
    );
  return (
    <>
      <div className="chart-legend">
        <span>
          <i />
          Received
        </span>
        <span>
          <i />
          Auto replies
        </span>
        <span>
          <i />
          Human replies
        </span>
        <small>
          Reported in {data.hourTimezone || 'UTC'} · calendar days and hourly buckets use UTC
        </small>
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: -20 }}>
            <CartesianGrid vertical={false} stroke="#e9ece8" strokeDasharray="3 5" />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              minTickGap={35}
              tick={{ fontSize: 11, fill: '#808780' }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: '#808780' }}
            />
            <Tooltip
              contentStyle={{ border: '1px solid #e5e8e3', borderRadius: 10, fontSize: 12 }}
            />
            <Area
              isAnimationActive={false}
              name="Received"
              type="monotone"
              dataKey="incoming"
              stroke="#326751"
              fill="#edf4f0"
              strokeWidth={2}
            />
            <Area
              isAnimationActive={false}
              name="Auto replies"
              type="monotone"
              dataKey="autoReplies"
              stroke="#8d9d90"
              fill="transparent"
              strokeWidth={2}
            />
            <Area
              isAnimationActive={false}
              name="Human replies"
              type="monotone"
              dataKey="manualReplies"
              stroke="#a9a08a"
              fill="transparent"
              strokeDasharray="4 4"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
