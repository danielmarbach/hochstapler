@desktop
Feature: Rolling out an update
  When a new version is released the players hardly notice: the page reconnects by itself,
  loads the new code and the game continues at the same point.

  Background:
    Given a dedicated server is running
    And Anna and Ben play a game in Switzerland
    And Anna already owns "Weggisgasse"
    And Anna has cash of 1'850
    And it is Anna's turn

  Scenario: Both players end up in the same game again after the update
    When the server is shut down for the update
    Then Anna sees the notice "Update wird eingespielt"
    And Ben sees the notice "Update wird eingespielt"
    And Anna sees the notice that the connection is lost
    When the new version "release-2" has started
    Then Anna has reloaded the page for version "release-2"
    And Ben has reloaded the page for version "release-2"
    And Anna sees themselves as "Anna (du)"
    And Ben sees themselves as "Ben (du)"
    And Anna has a balance of 1'850
    And Anna owns "Weggisgasse"
    And it is Anna's turn again
    And the page of Anna stays put afterwards
