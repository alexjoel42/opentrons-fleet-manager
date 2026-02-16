import React from 'react';
import RobotCard from '../molecules/RobotCard';

export default function RobotList({ robots, onDeleteRobot, onViewRobot }) {
  if (!robots || robots.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No robots added yet. Add a robot to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {robots.map((robot) => (
        <RobotCard
          key={robot.id}
          robot={robot}
          onDelete={onDeleteRobot}
          onView={onViewRobot}
        />
      ))}
    </div>
  );
}