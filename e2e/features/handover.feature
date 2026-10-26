@desktop
Feature: Handing the server over without an outage
  A new server instance takes over the database from the running one (writer lease). The players see a short
  reconnect, never an error page, and keep playing at the same point.

  Background:
    Given a dedicated server behind a load balancer is running
    And Anna and Ben play a game in Switzerland
    And Anna already owns "Weggisgasse"
    And Anna has cash of 1'850
    And it is Anna's turn

  Scenario: Playing on across a handover
    When a new server instance takes over
    Then Anna sees the notice "Server wechselt"
    And Anna no longer sees a connection notice
    And Ben no longer sees a connection notice
    And Anna has a balance of 1'850
    And Anna owns "Weggisgasse"
    And it is Anna's turn again
    And Anna can roll again
